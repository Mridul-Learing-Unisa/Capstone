import { useState } from "react"
import FolderIcon from "../icons/folder-icon"

type NameColumnProps = {
    title: string
    names: string[]
    selected: string | null
    onSelect: (name: string) => void
    onAdd: (name: string) => void
    disabled?: boolean
    emptyText?: string
}

// A selectable list of folder names with a "new name" field underneath.
export default function NameColumn({ title, names, selected, onSelect, onAdd, disabled, emptyText = "None yet" }: NameColumnProps) {
    const [draft, setDraft] = useState("")

    function add() {
        const name = draft.trim()
        if (!name) return
        onAdd(name)
        setDraft("")
    }

    return (
        <div className="flex flex-col gap-[0.5rem]">
            <h2>{title}</h2>

            <ul className="h-[15rem] overflow-y-auto rounded-[0.3rem] border border-disabled bg-bg-secondary">
                {names.length === 0 && <li className="text-small p-2">{emptyText}</li>}
                {names.map(name => (
                    <li key={name}>
                        <button
                            className={`flex w-full items-center gap-2 px-2 py-1 hover:bg-bg-tertiary disabled:cursor-default ${name === selected ? "bg-bg-tertiary" : ""}`}
                            onClick={() => onSelect(name)}
                            disabled={disabled}
                        >
                            <FolderIcon />
                            <span className="truncate">{name}</span>
                        </button>
                    </li>
                ))}
            </ul>

            <div className="flex gap-[0.5rem]">
                <input
                    type="text"
                    className="min-w-0"
                    placeholder={`New ${title.toLowerCase()} name`}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") add() }}
                    disabled={disabled}
                />
                <button type="button" onClick={add} disabled={disabled || !draft.trim()}>Add</button>
            </div>
        </div>
    )
}