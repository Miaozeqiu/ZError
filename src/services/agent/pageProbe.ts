/** get_page 次数。只用来提示「快照已经有了」，不挡看页。 */

const probes = new Map<string, number>()

export const notePageProbe = (browserId: string) => {
  const next = (probes.get(browserId) || 0) + 1
  probes.set(browserId, next)
  return next
}

export const resetPageProbe = (browserId: string) => {
  probes.delete(browserId)
}
