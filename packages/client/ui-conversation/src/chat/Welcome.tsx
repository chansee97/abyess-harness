import css from './Welcome.module.css'

/** Empty-transcript state shown when a session has no items yet. */
export function Welcome() {
  return (
    <div className={css.welcome}>
      <div className={css.welcomeTitle}>
        If you gaze long enough into an abyss,
        <br />
        the abyss will gaze back into you
      </div>
    </div>
  )
}
