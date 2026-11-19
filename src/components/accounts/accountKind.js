/**
 * What kind of account this is, for labels in the account lists:
 * - 'own': yours alone
 * - 'sharing': yours, and you've invited others
 * - 'joined': a friend's account you were invited to
 */
export function accountKind(account) {
  if (account.cloud && account.role && account.role !== 'owner') {
    const owner = account.members?.find(m => m.role === 'owner')
    return { kind: 'joined', owner: owner?.name ?? 'a friend', people: account.members?.length ?? 0 }
  }
  const people = account.members?.length ?? 1
  return { kind: people > 1 ? 'sharing' : 'own', people }
}

/** "Shared by Abebe · 4 people" / "Shared with 3 others" / null */
export function accountKindText(info) {
  if (info.kind === 'joined') return `Shared by ${info.owner.split(' ')[0]}${info.people > 1 ? ` · ${info.people} people` : ''}`
  if (info.kind === 'sharing') return `You share it with ${info.people - 1} other${info.people === 2 ? '' : 's'}`
  return null
}
