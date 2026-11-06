export default function DisabledIcon() {
    return (
        <svg className="w-[1.2rem] h-[1.2rem]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="11" stroke="var(--disabled-color)" stroke-width="2"/>
            <line x1="7" y1="11.72" x2="17" y2="11.72" stroke="var(--disabled-color)" stroke-width="2" stroke-linecap="round"/>
        </svg>
    )
}
