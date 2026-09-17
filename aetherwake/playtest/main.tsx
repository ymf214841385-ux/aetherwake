import { createRoot } from 'react-dom/client';
import { DefaultLoadingManager } from 'three';
import { GameApp } from '../src/game/Game';
import '../src/styles.css';

// Keep the audited game unchanged; adapt its asset URLs to GitHub Pages' subpath.
DefaultLoadingManager.setURLModifier((url) => url.startsWith('/assets/') ? `${import.meta.env.BASE_URL}${url.slice(1)}` : url);
createRoot(document.getElementById('root')!).render(<GameApp />);
