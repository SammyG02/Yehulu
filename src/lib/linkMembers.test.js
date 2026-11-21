import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planLink } from './linkMembers.js'

const t = (id, type, amount, date, ref) => ({ id, type, amount, date, ...(ref ? { ref } : {}) })

test('nothing in common: everything moves', () => {
  const plan = planLink([t('g1', 'deposit', 1000, '2026-01-01'), t('g2', 'withdrawal', 200, '2026-02-01')], [t('m1', 'deposit', 500, '2026-03-01')])
  assert.deepEqual(plan.move.map(x => x.id), ['g1', 'g2'])
  assert.equal(plan.doubles.length, 0)
})

test('the same deposit entered by both (within 3 days) is left out once', () => {
  const plan = planLink([t('g1', 'deposit', 1000, '2026-01-01'), t('g2', 'deposit', 1000, '2026-05-01')], [t('m1', 'deposit', 1000, '2026-01-03')])
  assert.deepEqual(plan.doubles.map(d => [d.guest.id, d.member.id]), [['g1', 'm1']])
  assert.deepEqual(plan.move.map(x => x.id), ['g2'], 'the later one is real, separate money')
})

test('4 days apart, a different amount or a different kind is not a double', () => {
  const plan = planLink(
    [t('a', 'deposit', 1000, '2026-01-01'), t('b', 'deposit', 1000.5, '2026-02-01'), t('c', 'withdrawal', 1000, '2026-03-01')],
    [t('x', 'deposit', 1000, '2026-01-05'), t('y', 'deposit', 1000, '2026-02-01'), t('z', 'deposit', 1000, '2026-03-01')],
  )
  assert.equal(plan.doubles.length, 0)
  assert.equal(plan.move.length, 3)
})

test('each of theirs matches at most one; two of the same amount need two of theirs', () => {
  const plan = planLink(
    [t('g1', 'deposit', 500, '2026-01-01'), t('g2', 'deposit', 500, '2026-01-02')],
    [t('m1', 'deposit', 500, '2026-01-01')],
  )
  assert.equal(plan.doubles.length, 1)
  assert.equal(plan.move.length, 1)
})

test('the same statement line is a double whatever its date', () => {
  const plan = planLink([t('g1', 'deposit', 300, '2026-01-01', 'y:3000:k')], [t('m1', 'deposit', 300, '2026-02-15', 'y:3000:k')])
  assert.equal(plan.doubles.length, 1)
})
