
const swatch = (name: string) => (
  <div key={name} style={{ background: `var(${name})`, border: '1px solid var(--border-primary)', padding: 'var(--padding-small)', minWidth: '9rem' }}>
    <span className="text-small">{name}</span>
  </div>
)

// Sample elements for checking the custom rules in index.css. Remove when done.
export default function TempUIForStyling() {
  return (
    <main style={{ padding: 'var(--padding-base)', display: 'flex', flexDirection: 'column', gap: 'var(--padding-base)' }}>
      <h1>Layout: #root (centered column, borders left/right)</h1>

      <section>
        <h2>section h2 (text-secondary)</h2>
        <p>Plain paragraph in section: text-primary on bg-main, with border, radius and shadow.</p>
        <p className="data">.data: Roboto Mono at --fs-base. 0123456789 12.345 m/s</p>
        <p className="text-small">.text-small: text-secondary at --fs-small</p>
      </section>

      <section>
        <h2>input[type="text"]</h2>
        <input type="text" placeholder="text input" />{' '}
        <input type="text" defaultValue="with value" />{' '}
        <input type="text" disabled defaultValue="disabled" />
        <p className="text-small">Not styled by your CSS (for comparison):</p>
        <input type="number" defaultValue={42} />{' '}
        <input type="password" placeholder="password" />
      </section>

      <section>
        <h2>Status colors</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['--success-color', '--processing-color', '--error-color', '--disabled-color'].map(swatch)}
        </div>
      </section>

      <section>
        <h2>Backgrounds and border</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['--bg-main', '--bg-secondary', '--bg-tertiary'].map(swatch)}
        </div>
      </section>

      <section>
        <h2>Text colors</h2>
        <p style={{ color: 'var(--text-primary)' }}>--text-primary</p>
        <p style={{ color: 'var(--text-secondary)' }}>--text-secondary</p>
      </section>

      <section>
        <h2>Font sizes</h2>
        <p style={{ fontSize: 'var(--fs-small)' }}>--fs-small (0.75rem)</p>
        <p style={{ fontSize: 'var(--fs-base)' }}>--fs-base (1rem)</p>
        <p style={{ fontSize: 'var(--fs-large)' }}>--fs-large (1.5rem)</p>
      </section>

      <section>
        <h2>Font families</h2>
        <p style={{ fontFamily: 'var(--sans)' }}>--sans: Inter Variable</p>
        <p style={{ fontFamily: 'var(--heading)' }}>--heading: Inter Variable</p>
        <p style={{ fontFamily: 'var(--mono)' }}>--mono: Roboto Mono Variable</p>
        <p className="font-sans">Tailwind font-sans</p>
        <p className="font-mono">Tailwind font-mono</p>
      </section>

      <section>
        <h2>Padding vars</h2>
        <div style={{ background: 'var(--bg-tertiary)', padding: 'var(--padding-base)' }}>
          <div style={{ background: 'var(--bg-main)', padding: 'var(--padding-small)' }}>
            --padding-small inside --padding-base
          </div>
        </div>
      </section>
    </main>
  )
}
