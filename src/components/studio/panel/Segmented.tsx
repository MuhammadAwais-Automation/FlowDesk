interface Option { value: string; label: string; disabled?: boolean }
interface Props { options: Option[]; value: string; onChange: (v: string) => void }

export default function Segmented({ options, value, onChange }: Props) {
  return (
    <div role="tablist" className="flex gap-0.5 rounded-[var(--panel-radius)] bg-s2 p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`flex-1 h-[calc(var(--panel-control-h)-4px)] rounded-[calc(var(--panel-radius)-1px)]
                      text-[length:var(--panel-label)] transition-colors
                      ${value === o.value ? 'bg-s3 text-tx' : 'text-t3 hover:text-t2'}
                      disabled:opacity-40 disabled:cursor-not-allowed`}
          title={o.disabled ? 'Not in this version' : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
