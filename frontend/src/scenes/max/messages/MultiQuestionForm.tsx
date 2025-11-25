import { useActions } from 'kea'
import { useState } from 'react'

import { IconCheck, IconChevronRight } from '@posthog/icons'
import { LemonButton, LemonInput } from '@posthog/lemon-ui'

import { MultiQuestionForm as MultiQuestionFormType } from '~/queries/schema/schema-assistant-messages'

import { maxThreadLogic } from '../maxThreadLogic'
import { MessageTemplate } from './MessageTemplate'

interface MultiQuestionFormComponentProps {
    form: MultiQuestionFormType
    isFinal: boolean
    /** Saved answers from the backend (used when the form was previously submitted and page is reloaded) */
    savedAnswers?: Record<string, string>
}

interface FormAnswers {
    [questionId: string]: string
}

export function MultiQuestionFormComponent({
    form,
    isFinal,
    savedAnswers,
}: MultiQuestionFormComponentProps): JSX.Element {
    const { askMax } = useActions(maxThreadLogic)
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
    const [answers, setAnswers] = useState<FormAnswers>({})
    const [customInput, setCustomInput] = useState('')
    const [showCustomInput, setShowCustomInput] = useState(false)
    const [isSubmitted, setIsSubmitted] = useState(false)

    const questions = form.questions
    if (!questions || questions.length === 0) {
        return <></>
    }
    const currentQuestion = questions[currentQuestionIndex]
    const isLastQuestion = currentQuestionIndex === questions.length - 1

    // If form has been submitted (not final) or all questions answered and submitted, show recap
    // Use savedAnswers from backend if available (for page reloads), otherwise use local answers state
    if (!isFinal || isSubmitted) {
        const displayAnswers = savedAnswers || answers
        return <FormRecap questions={questions} answers={displayAnswers} />
    }

    const handleOptionSelect = (value: string): void => {
        const newAnswers = { ...answers, [currentQuestion.id]: value }
        setAnswers(newAnswers)
        setShowCustomInput(false)
        setCustomInput('')

        if (isLastQuestion) {
            submitForm(newAnswers)
        } else {
            setCurrentQuestionIndex(currentQuestionIndex + 1)
        }
    }

    const handleCustomSubmit = (): void => {
        if (!customInput.trim()) {
            return
        }

        const newAnswers = { ...answers, [currentQuestion.id]: customInput.trim() }
        setAnswers(newAnswers)
        setShowCustomInput(false)
        setCustomInput('')

        if (isLastQuestion) {
            submitForm(newAnswers)
        } else {
            setCurrentQuestionIndex(currentQuestionIndex + 1)
        }
    }

    const submitForm = (finalAnswers: FormAnswers): void => {
        setIsSubmitted(true)

        // Format answers as a readable text response
        const formattedResponse = questions
            .map((q) => {
                const answer = finalAnswers[q.id]
                return `${q.question}: ${answer}`
            })
            .join('\n')

        askMax(formattedResponse, false)
    }

    const allowCustomAnswer = currentQuestion.allow_custom_answer !== false

    return (
        <MessageTemplate type="ai" wrapperClassName="w-full">
            <div className="flex flex-col gap-3">
                {/* Progress indicator */}
                {questions.length > 1 && (
                    <div className="flex items-center gap-2 text-xs text-muted">
                        <span>
                            Question {currentQuestionIndex + 1} of {questions.length}
                        </span>
                        <div className="flex gap-1">
                            {questions.map((_, index) => (
                                <div
                                    key={index}
                                    className={`w-2 h-2 rounded-full ${
                                        index < currentQuestionIndex
                                            ? 'bg-success'
                                            : index === currentQuestionIndex
                                              ? 'bg-primary'
                                              : 'bg-border'
                                    }`}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Question */}
                <div className="font-medium">{currentQuestion.question}</div>

                {/* Options */}
                <div className="flex flex-col gap-1.5">
                    {currentQuestion.options &&
                        currentQuestion.options.map((option, index) => (
                            <div className="flex items-center gap-2">
                                <span className="text-muted size-4 shrink-0">{index + 1}.</span>
                                <LemonButton
                                    key={option.value}
                                    onClick={() => handleOptionSelect(option.value)}
                                    type="secondary"
                                    size="small"
                                    className="justify-start text-wrap w-[calc(100%-2rem)]"
                                >
                                    {option.value}
                                </LemonButton>
                            </div>
                        ))}

                    {/* Custom answer option */}
                    {allowCustomAnswer && !showCustomInput && (
                        <LemonButton
                            onClick={() => setShowCustomInput(true)}
                            type="tertiary"
                            size="small"
                            fullWidth
                            className="justify-start text-muted"
                            sideIcon={<IconChevronRight />}
                        >
                            Type your answer
                        </LemonButton>
                    )}

                    {/* Custom input field */}
                    {showCustomInput && (
                        <div className="flex gap-1.5 items-center mt-1">
                            <LemonInput
                                placeholder="Type your answer..."
                                fullWidth
                                value={customInput}
                                onChange={(newValue) => setCustomInput(newValue)}
                                onPressEnter={() => handleCustomSubmit()}
                                autoFocus
                            />
                            <LemonButton
                                type="primary"
                                onClick={() => handleCustomSubmit()}
                                disabledReason={!customInput.trim() ? 'Please type an answer' : undefined}
                            >
                                Submit
                            </LemonButton>
                            <LemonButton type="tertiary" onClick={() => setShowCustomInput(false)}>
                                Cancel
                            </LemonButton>
                        </div>
                    )}
                </div>
            </div>
        </MessageTemplate>
    )
}

interface FormRecapProps {
    questions: MultiQuestionFormType['questions']
    answers: FormAnswers
}

function FormRecap({ questions, answers }: FormRecapProps): JSX.Element {
    return (
        <MessageTemplate type="ai">
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                    <IconCheck className="text-success" />
                    <span>Form submitted</span>
                </div>
                <div className="flex flex-col gap-1.5">
                    {questions.map((question) => (
                        <div key={question.id} className="text-sm">
                            <span className="text-muted">{question.question}:</span>{' '}
                            <span className="font-medium">{answers[question.id] || '—'}</span>
                        </div>
                    ))}
                </div>
            </div>
        </MessageTemplate>
    )
}
