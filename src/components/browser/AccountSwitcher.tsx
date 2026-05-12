import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AIAccount } from '@/types/database'

interface Props {
  accounts: AIAccount[]
  activeId: string | null
  onSwitch: (account: AIAccount) => void
  onAdd: () => void
}

export default function AccountSwitcher({ accounts, activeId, onSwitch, onAdd }: Props) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-100 flex-shrink-0 overflow-x-auto">
      <span className="text-xs text-gray-500 font-medium mr-1 flex-shrink-0">Account:</span>
      {accounts.map(acc => (
        <button
          key={acc.id}
          onClick={() => onSwitch(acc)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors flex-shrink-0',
            activeId === acc.id
              ? 'bg-purple-600 text-white border-purple-600'
              : 'border-gray-200 text-gray-600 hover:border-purple-300'
          )}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
          {acc.gmail}
        </button>
      ))}
      <button
        onClick={onAdd}
        className="flex items-center gap-1 px-3 py-1 rounded-full text-xs border border-dashed border-gray-300 text-gray-400 hover:border-purple-400 hover:text-purple-600 flex-shrink-0"
      >
        <Plus size={11} /> Add
      </button>
    </div>
  )
}
