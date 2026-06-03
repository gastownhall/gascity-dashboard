import { Suspense, useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api/client';
import { AttentionProvider } from './attention/context';
import { useLiveAttentionContributors } from './attention/liveContributors';
import { Layout } from './components/Layout';
import { AgentsPage } from './routes/Agents';
import { AgentDetailPage } from './routes/AgentDetail';
import { AmbientHomePage } from './routes/AmbientHome';
import { BeadsPage } from './routes/Beads';
import { MailPage } from './routes/Mail';
import { FormulaRunDetailPage } from './routes/FormulaRunDetail';
import { RunsPage } from './routes/Runs';
import { NowProvider } from './contexts/NowContext';
import { ViewingAsProvider } from './contexts/ViewingAsContext';
import { useCachedData } from './hooks/useCachedData';
import { ALL_VIEWS } from './views/registry';
import { filterEnabledViews, resolveDefaultViewWithLogging } from './views/resolve';

export function App() {
  // NowProvider lives at the App root because useFaviconSignal (R8) is
  // mounted inside the L0 ambient home but the favicon swap must persist
  // across routes — a future refactor that mounts the signal on every
  // route stays straightforward because the 1s tick is already global.

  // PR-C: the backend's /api/config carries the operator's MODULES_ENABLED
  // intersection and the DEFAULT_VIEW env value. While the request is in
  // flight `data` is undefined; we treat that as "use the pre-PR-C
  // behaviour" (every firstParty mounted, ambient home at /) so the first
  // paint never blanks. Once the response lands React re-renders the route
  // tree with the resolved set.
  const { data: config } = useCachedData('config', () => api.config());
  const enabledModules = config?.enabledModules ?? null;
  const defaultViewEnv = config?.defaultView ?? null;
  const attentionContributors = useLiveAttentionContributors(enabledModules);

  const enabledViews = useMemo(
    () => filterEnabledViews(ALL_VIEWS, enabledModules),
    [enabledModules],
  );
  const defaultResolution = useMemo(
    () => resolveDefaultViewWithLogging(enabledViews, defaultViewEnv),
    [enabledViews, defaultViewEnv],
  );
  const DefaultViewElement = defaultResolution.view?.element ?? null;
  // dw8 — when `DEFAULT_VIEW` resolves to a view alias (e.g. `needs-you`),
  // the resolver returns no `view` but a `redirectTo` path. Render
  // `<Navigate replace>` at `/` so the URL bar shows the parametrised
  // path the operator is actually viewing; `replace` keeps the back
  // button pointing at wherever the operator came from, not at the
  // resolved alias hop.
  const defaultRedirectTo = defaultResolution.redirectTo ?? null;

  return (
    <ViewingAsProvider>
      <NowProvider>
        <AttentionProvider contributors={attentionContributors}>
          <Layout>
            <Suspense fallback={null}>
              <Routes>
              {/* `/` resolution (PRD §6 / bead 9yj.5):
                  DEFAULT_VIEW env → descriptor `defaultRoute: true` →
                  kb3 ambient home fallback. The resolver runs once per
                  enabled-set / env change; warnings surface in the
                  browser console for premortem #5 visibility. */}
              <Route
                path="/"
                element={
                  defaultRedirectTo !== null ? (
                    <Navigate to={defaultRedirectTo} replace />
                  ) : DefaultViewElement !== null ? (
                    <DefaultViewElement />
                  ) : (
                    <AmbientHomePage />
                  )
                }
              />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/:slug" element={<AgentDetailPage />} />
              <Route path="/beads" element={<BeadsPage />} />
              <Route path="/runs" element={<RunsPage />} />
              <Route path="/runs/:runId" element={<FormulaRunDetailPage />} />
              <Route path="/mail" element={<MailPage />} />
              {/* Modular-dashboard registry routes, filtered by the
                  backend's enabledModules set. A disabled module's path
                  is absent (not 404'd by React Router) so deep-link bookmarks
                  surface the operator's MODULES_ENABLED change as a 404,
                  not a blank route. */}
              {enabledViews.map((v) => {
                const Element = v.element;
                return <Route key={v.id} path={v.path} element={<Element />} />;
              })}
              <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </Layout>
        </AttentionProvider>
      </NowProvider>
    </ViewingAsProvider>
  );
}

function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-title" className="space-y-3">
      <h1 id="not-found-title" className="text-5xl font-semibold tracking-tight text-fg">
        Page not found
      </h1>
      <p className="text-title text-fg-muted">No dashboard route matches this path.</p>
    </section>
  );
}
