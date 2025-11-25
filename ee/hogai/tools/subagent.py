import uuid
from typing import TYPE_CHECKING, Literal, Self, cast

import structlog
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, Field

from posthog.schema import (
    AgentMode,
    AssistantEventType,
    AssistantMessage,
    AssistantToolCallMessage,
    AssistantUpdateEvent,
    VisualizationArtifactMessage,
)

from posthog.models import Team, User

from ee.hogai.context.context import AssistantContextManager
from ee.hogai.core.executor import AgentExecutor
from ee.hogai.stream.redis_stream import get_subagent_stream_key
from ee.hogai.tool import MaxTool, ToolMessagesArtifact
from ee.hogai.utils.types.base import AssistantMessageUnion, AssistantState, NodePath
from ee.models import Conversation

if TYPE_CHECKING:
    from ee.hogai.core.agent_modes.factory import AgentModeDefinition

logger = structlog.get_logger(__name__)

SUBAGENT_TOOL_PROMPT = """
Delegate independent analytical tasks to autonomous subagents that run in parallel.
One tool call per subagent, always batch multiple subagent tool calls. If you don't need parallelization, skip this tool and do the task yourself.

## When to Use
- Running multiple independent analyses simultaneously (e.g., "analyze conversion rates" AND "analyze retention" for the same user segment)
- Exploring different angles of the same question in parallel
- Evaluating multiple hypotheses in parallel

## When NOT to Use
- Running sequential tasks where one depends on another's output
- Simple single-step queries
- Tasks requiring shared context or state between analyses that can't be parallelized

## How It Works
Each subagent:{mode_prompt}
- Has access to all your tools (search, read_taxonomy, read_data, etc.)
- Operates in complete isolation (no shared memory or context with other subagents)
- Returns only its final conclusion

## Writing Effective Task Prompts
Be specific and self-contained. The subagent has NO context about your conversation.

**Bad**: "Now analyze the retention"
**Good**: "Analyze 7-day retention rates for users who signed up in the last 30 days. Break down by signup source (organic, paid, referral). Identify which source has the best retention and suggest why."

Include:
1. The specific metric or question to investigate
2. Time ranges and filters to apply
3. What format/detail level you need in the response
""".strip()


class SubagentExecutor(AgentExecutor):
    """Executor for subagent workflows that uses a tool-specific stream key."""

    def __init__(self, conversation: Conversation, tool_call_id: str, **kwargs):
        super().__init__(conversation, **kwargs)
        self._tool_call_id = tool_call_id
        stream_key = get_subagent_stream_key(conversation.id, tool_call_id)
        self._redis_stream._stream_key = stream_key
        self._workflow_id = f"subagent-{conversation.id}-{tool_call_id}"
        self._can_reconnect = False


class SubagentToolArgs(BaseModel):
    title: str = Field(description="A short title for the task")
    task: str = Field(
        description="A clear, detailed description of the task for the subagent to complete. Include all relevant context and desired outcome."
    )


class SubagentTool(MaxTool):
    name: Literal["subagent"] = "subagent"
    description: str = SUBAGENT_TOOL_PROMPT
    args_schema: type[BaseModel] = SubagentToolArgs
    billable: bool = True

    async def _arun_impl(self, title: str, task: str) -> tuple[str, ToolMessagesArtifact | None]:
        # Avoid circular import
        from posthog.temporal.ai.chat_agent import SubagentWorkflow, SubagentWorkflowInputs

        conversation = await Conversation.objects.acreate(
            team=self._team,
            user=self._user,
            title=title,
            type=Conversation.Type.TOOL_CALL,
            tool_call_id=self.tool_call_id,
        )

        inputs = SubagentWorkflowInputs(
            team_id=self._team.id,
            user_id=self._user.id,
            conversation_id=conversation.id,
            tool_call_id=self.tool_call_id,
            task=task,
            trace_id=self._get_trace_id(self._config),
            session_id=self._get_session_id(self._config),
            billing_context=self._context_manager.get_billing_context(),
        )

        executor = SubagentExecutor(
            conversation=conversation,
            tool_call_id=self.tool_call_id,
        )

        final_content = ""

        messages: list[AssistantMessageUnion] = []
        try:
            async for event_type, message in executor.astream(SubagentWorkflow, inputs):
                if event_type == AssistantEventType.MESSAGE:
                    # Only parse completed messages
                    if not message.id:
                        continue
                    if isinstance(message, AssistantMessage):
                        final_content = message.content
                        if message.tool_calls:
                            for tool_call in message.tool_calls:
                                # HACK: We only support string updates for now
                                self.dispatcher.update("tool_call::" + tool_call.model_dump_json())
                    if isinstance(message, VisualizationArtifactMessage):
                        self.dispatcher.message(message)
                        messages.append(message)
                elif event_type == AssistantEventType.UPDATE:
                    self.dispatcher.update(cast(AssistantUpdateEvent, message).content)

        except Exception as e:
            logger.exception("Error running subagent", error=e)
            return f"Error running subagent: {e}", None

        messages = [
            *messages,
            AssistantToolCallMessage(content=final_content, tool_call_id=self.tool_call_id, id=str(uuid.uuid4())),
        ]
        return "", ToolMessagesArtifact(messages=messages)

    @classmethod
    async def create_tool_class(
        cls,
        *,
        team: Team,
        user: User,
        mode_registry: dict[AgentMode, "AgentModeDefinition"],
        node_path: tuple[NodePath, ...] | None = None,
        state: AssistantState | None = None,
        config: RunnableConfig | None = None,
        context_manager: AssistantContextManager | None = None,
    ) -> Self:
        mode_prompt = ""
        if len(mode_registry) > 1:
            mode_prompt = f"\n- Has access to these modes:{'\n'.join([f"    - {mode.value}: {definition.mode_description}" for mode, definition in mode_registry.items()])}"
        description = SUBAGENT_TOOL_PROMPT.format(mode_prompt=mode_prompt)

        return cls(
            team=team,
            user=user,
            state=state,
            node_path=node_path,
            config=config,
            description=description,
            context_manager=context_manager,
        )
