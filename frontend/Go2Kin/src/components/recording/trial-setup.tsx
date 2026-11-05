type Props = {
    trialName: string
    sound: string[]   // X, Y, Z kept as text so half-typed numbers like "-" still work
    locked: boolean   // can't edit while recording or processing
    onTrialNameChange: (name: string) => void
    onSoundChange: (sound: string[]) => void
}

// "Trial Setup" box at the top left of the Recording tab
export default function TrialSetup({ trialName, sound, locked, onTrialNameChange, onSoundChange }: Props) {
    function changeAxis(index: number, value: string) {
        onSoundChange(sound.map((old, i) => i === index ? value : old))
    }

    return (
        <section className="flex flex-col gap-4">
            <h2 className="text-large">Trial Setup</h2>

            <div className="flex gap-6">
                <label className="flex flex-col gap-1">
                    Trial Name
                    <input
                        type="text"
                        className="data w-36"
                        value={trialName}
                        disabled={locked}
                        onChange={e => onTrialNameChange(e.target.value)}
                    />
                </label>

                <div className="flex flex-col gap-1">
                    Sound Source (m)
                    <div className="flex gap-2">
                        {["X", "Y", "Z"].map((axis, i) => (
                            <label key={axis} className="flex items-center gap-1">
                                <span className="text-small">{axis}</span>
                                <input
                                    type="text"
                                    className="data w-14"
                                    value={sound[i]}
                                    disabled={locked}
                                    onChange={e => changeAxis(i, e.target.value)}
                                />
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    )
}
