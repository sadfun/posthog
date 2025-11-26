import { actions, connect, kea, key, listeners, path, props, reducers } from 'kea'

import { quickFiltersLogic } from 'lib/components/QuickFilters'

import { QuickFilterContext } from '~/queries/schema/schema-general'
import { PropertyOperator } from '~/types'

import type { quickFiltersSectionLogicType } from './quickFiltersSectionLogicType'

export interface SelectedQuickFilter {
    propertyName: string
    value: string | null
    operator: PropertyOperator
}

export interface QuickFiltersSectionLogicProps {
    context: QuickFilterContext
}

export const quickFiltersSectionLogic = kea<quickFiltersSectionLogicType>([
    path(['lib', 'components', 'QuickFilters', 'quickFiltersSectionLogic']),
    props({} as QuickFiltersSectionLogicProps),
    key((props) => props.context),

    connect((props: QuickFiltersSectionLogicProps) => ({
        values: [quickFiltersLogic({ context: props.context }), ['quickFilters']],
        actions: [quickFiltersLogic({ context: props.context }), ['deleteFilter']],
    })),

    actions({
        setQuickFilterValue: (propertyName: string, value: string | null, operator: PropertyOperator | null) => ({
            propertyName,
            value,
            operator,
        }),
        setQuickFilters: (quickFilters: Record<string, SelectedQuickFilter>) => ({ quickFilters }),
    }),

    reducers({
        selectedQuickFilters: [
            {} as Record<string, SelectedQuickFilter>,
            {
                setQuickFilterValue: (state, { propertyName, value, operator }) => {
                    if (value === null && operator === null) {
                        const newState = { ...state }
                        delete newState[propertyName]
                        return newState
                    }
                    return {
                        ...state,
                        [propertyName]: {
                            propertyName,
                            value,
                            operator: operator || PropertyOperator.Exact,
                        },
                    }
                },
                setQuickFilters: (state, { quickFilters }) => quickFilters,
            },
        ],
    }),

    listeners(({ actions, values }) => ({
        deleteFilter: ({ id }) => {
            const newFilters = [...values.quickFilters].filter((f) => f.id != id)
            actions.setQuickFilters(newFilters)
        },
    })),
])
