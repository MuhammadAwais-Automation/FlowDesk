import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from '../database'
import { EntityStore } from './entities'

const brains: BrainDatabase[] = []
const roots: string[] = []

afterEach(() => {
  for (const brain of brains.splice(0)) brain.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-entities-'))
  roots.push(root)
  const brain = new BrainDatabase(join(root, 'brain.sqlite'))
  brains.push(brain)
  const scope = brain.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
  const other = brain.ensureScope({ type: 'client', externalRef: 'other', name: 'Other' })
  return { brain, scope, other, store: new EntityStore(brain.handle) }
}

describe('EntityStore.resolve', () => {
  it('creates an entity and a verified alias for a new identifier', () => {
    const { store, scope } = createStore()
    const yasir = store.resolve({
      scopeId: scope.id, type: 'person', name: 'Yasir Bhai',
      identifier: { kind: 'phone', value: '+923001234567' },
    })
    expect(yasir.name).toBe('Yasir Bhai')
    expect(store.list([scope.id])).toHaveLength(1)
  })

  it('returns the same entity for the same identifier, whatever the name says', () => {
    const { store, scope } = createStore()
    const first = store.resolve({
      scopeId: scope.id, type: 'person', name: 'Yasir Bhai',
      identifier: { kind: 'phone', value: '+923001234567' },
    })
    const second = store.resolve({
      scopeId: scope.id, type: 'person', name: 'Yasir',
      identifier: { kind: 'PHONE', value: ' +923001234567 ' },
    })
    expect(second.id).toBe(first.id)
    expect(store.list([scope.id])).toHaveLength(1)
  })

  it('finds an entity by name when there is no identifier to go on', () => {
    const { store, scope } = createStore()
    const first = store.resolve({ scopeId: scope.id, type: 'org', name: 'TWG Trade Finance' })
    const second = store.resolve({ scopeId: scope.id, type: 'org', name: '  twg   trade finance  ' })
    expect(second.id).toBe(first.id)
  })

  it('refuses to merge a new identifier onto a matching name, and proposes instead', () => {
    const { store, scope } = createStore()
    // Two different people can share a display name; only an identifier is evidence.
    const fromVault = store.resolve({ scopeId: scope.id, type: 'person', name: 'Yasir Bhai' })
    const fromWhatsApp = store.resolve({
      scopeId: scope.id, type: 'person', name: 'Yasir Bhai',
      identifier: { kind: 'phone', value: '+923001234567' },
    })

    expect(fromWhatsApp.id).not.toBe(fromVault.id)
    expect(store.list([scope.id])).toHaveLength(2)
    const [proposal] = store.listProposals([scope.id])
    expect(proposal).toMatchObject({ keepEntityId: fromWhatsApp.id, mergeEntityId: fromVault.id, status: 'pending' })
  })

  it('keeps entities inside their own scope', () => {
    const { store, scope, other } = createStore()
    store.resolve({ scopeId: scope.id, type: 'person', name: 'Yasir Bhai' })
    expect(store.list([other.id])).toHaveLength(0)
    expect(store.list([scope.id])).toHaveLength(1)
  })

  it('refuses a nameless entity', () => {
    const { store, scope } = createStore()
    expect(() => store.resolve({ scopeId: scope.id, type: 'person', name: '   ' })).toThrow(/name/)
  })
})

describe('EntityStore mentions', () => {
  it('records a mention once however many times it is offered', () => {
    const { store, scope } = createStore()
    const yasir = store.resolve({ scopeId: scope.id, type: 'person', name: 'Yasir Bhai' })
    store.mention(yasir.id, 'document', 'doc-1', 'wiki/clients/yasir-bhai.md')
    store.mention(yasir.id, 'document', 'doc-1', 'wiki/clients/yasir-bhai.md')
    expect(store.mentionsOf(yasir.id)).toHaveLength(1)
  })

  it('answers in both directions and filters by kind', () => {
    const { store, scope } = createStore()
    const yasir = store.resolve({ scopeId: scope.id, type: 'person', name: 'Yasir Bhai' })
    store.mention(yasir.id, 'document', 'doc-1')
    store.mention(yasir.id, 'opportunity', 'opp-9')

    expect(store.mentionsOf(yasir.id)).toHaveLength(2)
    expect(store.mentionsOf(yasir.id, 'opportunity')).toMatchObject([{ targetId: 'opp-9' }])
    expect(store.entitiesFor([scope.id], 'document', 'doc-1')).toMatchObject([{ id: yasir.id }])
  })

  it('does not leak a mention across scopes', () => {
    const { store, scope, other } = createStore()
    const yasir = store.resolve({ scopeId: scope.id, type: 'person', name: 'Yasir Bhai' })
    store.mention(yasir.id, 'document', 'doc-1')
    expect(store.entitiesFor([other.id], 'document', 'doc-1')).toHaveLength(0)
  })
})

describe('EntityStore.decideProposal', () => {
  function twoOfThem() {
    const context = createStore()
    const vault = context.store.resolve({ scopeId: context.scope.id, type: 'person', name: 'Yasir Bhai' })
    context.store.mention(vault.id, 'document', 'doc-1')
    const whatsApp = context.store.resolve({
      scopeId: context.scope.id, type: 'person', name: 'Yasir Bhai',
      identifier: { kind: 'phone', value: '+923001234567' },
    })
    context.store.mention(whatsApp.id, 'episode', 'msg-1')
    const [proposal] = context.store.listProposals([context.scope.id])
    return { ...context, vault, whatsApp, proposal }
  }

  it('accepting moves everything onto the kept entity and removes the other', () => {
    const { store, scope, vault, whatsApp, proposal } = twoOfThem()
    expect(store.decideProposal(proposal.id, 'accept')).toBe(true)

    expect(store.list([scope.id])).toHaveLength(1)
    expect(store.get([scope.id], vault.id)).toBeNull()
    expect(store.mentionsOf(whatsApp.id).map(mention => mention.targetId).sort()).toEqual(['doc-1', 'msg-1'])
    expect(store.listProposals([scope.id])).toHaveLength(0)
  })

  it('rejecting leaves both standing and clears the proposal', () => {
    const { store, scope, proposal } = twoOfThem()
    expect(store.decideProposal(proposal.id, 'reject')).toBe(true)
    expect(store.list([scope.id])).toHaveLength(2)
    expect(store.listProposals([scope.id])).toHaveLength(0)
  })

  it('a proposal can only be decided once', () => {
    const { store, proposal } = twoOfThem()
    expect(store.decideProposal(proposal.id, 'reject')).toBe(true)
    expect(store.decideProposal(proposal.id, 'accept')).toBe(false)
  })
})
