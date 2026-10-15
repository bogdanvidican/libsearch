import { ArrowRight, Database } from 'lucide-react';
import { useApp } from '../context';
import { etaText, percent } from '../format';
import { navigate } from '../router';
import { S } from '../strings';
import { categoryIcon } from './icons';
import { SearchBox } from './SearchBox';
import { LibraryFolders } from './LibraryFolders';

export function Home({ onSearch }: { onSearch: (q: string) => void }) {
  const app = useApp();
  const st = app.status;
  const docs = st ? st.index.docs : 0;
  const building = !!st && st.index.build.running;
  const noIndex = !!st && (!st.index.exists || st.index.docs === 0);
  // The app can be installed anywhere: when it can't find a library next to itself, ask for the folder first.
  const noLibrary = !!st && st.roots.length === 0;

  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title" className="hero__title">
          {S.home.title}
        </h1>
        <p className="hero__sub">{S.home.subtitle(docs)}</p>
        <SearchBox variant="hero" value="" onSearch={onSearch} autoFocus />
        <div className="examples">
          <span className="examples__label">{S.search.tryLabel}</span>
          {S.search.examples.map((ex) => (
            <button key={ex} type="button" className="chip chip--example" onClick={() => onSearch(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </section>

      {noLibrary && st ? (
        <LibraryFolders st={st} variant="setup" />
      ) : building && st ? (
        <section className="card setup setup--building" aria-live="polite">
          <div className="setup__icon" aria-hidden="true">
            <Database size={24} />
          </div>
          <div className="setup__body">
            <h2 className="setup__title">{S.home.buildingTitle}</h2>
            <p className="setup__text">{S.home.buildingBody}</p>
            <div
              className="progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent(st.index.build.done, st.index.build.total)}
            >
              <span className="progress__fill" style={{ width: percent(st.index.build.done, st.index.build.total) + '%' }} />
            </div>
            <p className="setup__meta">
              {S.library.progress(st.index.build.done, st.index.build.total)}
              {etaText(st.index.build, Date.now()) ? ' · ' + etaText(st.index.build, Date.now()) : ''}
            </p>
          </div>
        </section>
      ) : noIndex ? (
        <section className="card setup">
          <div className="setup__icon" aria-hidden="true">
            <Database size={24} />
          </div>
          <div className="setup__body">
            <h2 className="setup__title">{S.home.firstRunTitle}</h2>
            <p className="setup__text">{S.home.firstRunBody}</p>
            <button type="button" className="btn btn--primary btn--lg" onClick={() => app.startBuild(false)}>
              {S.home.firstRunButton}
            </button>
          </div>
        </section>
      ) : null}

      {app.categories.length > 0 ? (
        <section className="topics" aria-labelledby="topics-title">
          <div className="section-head">
            <h2 id="topics-title" className="section-head__title">
              {S.home.browseTitle}
            </h2>
            <a className="link-btn" href="#/browse">
              {S.home.browseAll}
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
          <ul className="tiles" role="list">
            {app.categories.map((c) => {
              const Icon = categoryIcon(c.label);
              return (
                <li key={c.folder}>
                  <button type="button" className="tile" onClick={() => navigate({ name: 'browse', folder: c.folder })}>
                    <span className="tile__icon" aria-hidden="true">
                      <Icon size={22} />
                    </span>
                    <span className="tile__text">
                      <span className="tile__label">{c.label}</span>
                      <span className="tile__count">{S.browse.docs(c.docs)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
