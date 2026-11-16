import { useMemo } from 'react'
import { planGoal } from '../lib/interest.js'
import { useSavings } from '../state/hooks.js'

/** Runs the goal planner for a saved goal, with and without the monthly top-up. */
export function useGoalPlan(goal) {
  const { transactions, rates, today } = useSavings()
  return useMemo(() => {
    if (!goal.target) return null
    return {
      plan: planGoal({ transactions, rates, today, target: goal.target, monthlyDeposit: goal.monthly }),
      without: goal.monthly > 0 ? planGoal({ transactions, rates, today, target: goal.target }) : undefined,
    }
  }, [goal.target, goal.monthly, transactions, rates, today])
}
