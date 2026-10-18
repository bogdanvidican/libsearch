import { BookOpen, House, LayoutGrid, LibraryBig, Settings } from 'lucide-react';
import { navigate, Route } from '../router';
import { S } from '../strings';
import { SearchBox } from './SearchBox';

interface Props {
  route: Route;
  onSearch: (q: string) => void;
  libraryAlert: boolean;
  /** An update is ready to install, or failed. */
  settingsAlert: boolean;
  /** Last searched words, kept in the box while reading an article. */
  lastQuery: string;
}

export function Header({ route, onSearch, libraryAlert, settingsAlert, lastQuery }: Props) {
  const showSearch = route.name !== 'home';
  const q = route.name === 'search' ? route.q : route.name === 'read' ? lastQuery : '';
  // Get books is part of Library.
  const active = route.name === 'books' ? 'library' : route.name;

  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label={S.appName + ' — ' + S.nav.home}>
        <span className="brand__mark" aria-hidden="true">
          <BookOpen size={22} strokeWidth={2.25} />
        </span>
        <span className="brand__text">
          <span className="brand__name">{S.appName}</span>
          <span className="brand__tag">{S.appTagline}</span>
        </span>
      </a>
      <div className="topbar__search">{showSearch ? <SearchBox variant="bar" value={q} onSearch={onSearch} /> : null}</div>
      <nav className="topnav" aria-label={S.nav.main}>
        <NavButton
          label={S.nav.home}
          icon={<House size={20} aria-hidden="true" />}
          current={active === 'home'}
          onClick={() => navigate({ name: 'home' })}
        />
        <NavButton
          label={S.nav.browse}
          icon={<LayoutGrid size={20} aria-hidden="true" />}
          current={active === 'browse'}
          onClick={() => navigate({ name: 'browse', folder: '' })}
        />
        <NavButton
          label={S.nav.library}
          icon={<LibraryBig size={20} aria-hidden="true" />}
          current={active === 'library'}
          alert={libraryAlert}
          onClick={() => navigate({ name: 'library' })}
        />
        <NavButton
          label={S.nav.settings}
          icon={<Settings size={20} aria-hidden="true" />}
          current={active === 'settings' || active === 'docs'}
          alert={settingsAlert}
          onClick={() => navigate({ name: 'settings' })}
        />
      </nav>
    </header>
  );
}

function NavButton(props: { label: string; icon: JSX.Element; current: boolean; alert?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={'topnav__item' + (props.current ? ' is-current' : '')}
      aria-current={props.current ? 'page' : undefined}
      onClick={props.onClick}
      title={props.label}
    >
      {props.icon}
      <span className="topnav__label">{props.label}</span>
      {props.alert ? <span className="topnav__dot" aria-hidden="true" /> : null}
    </button>
  );
}
