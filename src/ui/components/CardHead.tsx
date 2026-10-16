export type Tone = 'ok' | 'busy' | 'warn' | 'bad';

/** Icon tile + title at the top of a card (Library and Settings pages). */
export function CardHead({ icon, title, tone }: { icon: JSX.Element; title: string; tone?: Tone }) {
  return (
    <div className="card__head">
      <span className={'card__icon' + (tone ? ' card__icon--' + tone : '')} aria-hidden="true">
        {icon}
      </span>
      <h2 className="card__title">{title}</h2>
    </div>
  );
}
