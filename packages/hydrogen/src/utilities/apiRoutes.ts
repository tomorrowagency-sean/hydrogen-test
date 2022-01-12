import {ImportGlobEagerOutput} from '../types';
import {matchPath} from './matchPath';
import {Logger, logServerResponse} from '../utilities/log/log';
import {ServerComponentRequest} from '../framework/Hydration/ServerComponentRequest.server';

let cachedRoutes: Array<HydrogenApiRoute> = [];

type RouteParams = Record<string, string>;
type RequestOptions = {
  params: RouteParams;
};
type ResourceGetter = (
  request: Request,
  requestOptions: RequestOptions
) => Promise<Response>;

interface HydrogenApiRoute {
  path: string;
  resource: ResourceGetter;
}

export type ApiRouteMatch = {
  resource: ResourceGetter;
  params: RouteParams;
};

export function getApiRoutesFromPages(
  pages: ImportGlobEagerOutput | undefined,
  topLevelPath = '*'
): Array<HydrogenApiRoute> {
  if (cachedRoutes?.length || !pages) return cachedRoutes;

  const topLevelPrefix = topLevelPath.replace('*', '').replace(/\/$/, '');

  const routes = Object.keys(pages)
    .filter((key) => pages[key].api)
    .map((key) => {
      const path = key
        .replace('./pages', '')
        .replace(/\.server\.(t|j)sx?$/, '')
        /**
         * Replace /index with /
         */
        .replace(/\/index$/i, '/')
        /**
         * Only lowercase the first letter. This allows the developer to use camelCase
         * dynamic paths while ensuring their standard routes are normalized to lowercase.
         */
        .replace(/\b[A-Z]/, (firstLetter) => firstLetter.toLowerCase())
        /**
         * Convert /[handle].jsx and /[...handle].jsx to /:handle.jsx for react-router-dom
         */
        .replace(
          /\[(?:[.]{3})?(\w+?)\]/g,
          (_match, param: string) => `:${param}`
        );

      /**
       * Catch-all routes [...handle].jsx don't need an exact match
       * https://reactrouter.com/core/api/Route/exact-bool
       */
      const exact = !/\[(?:[.]{3})(\w+?)\]/.test(key);

      return {
        path: topLevelPrefix + path,
        resource: pages[key].api,
        exact,
      };
    });

  cachedRoutes = [
    ...routes.filter((route) => !route.path.includes(':')),
    ...routes.filter((route) => route.path.includes(':')),
  ];

  return cachedRoutes;
}

export function getApiRouteFromURL(
  url: URL,
  routes: Array<HydrogenApiRoute>
): ApiRouteMatch | null {
  let foundRoute, foundRouteDetails;

  for (let i = 0; i < routes.length; i++) {
    foundRouteDetails = matchPath(url.pathname, routes[i]);

    if (foundRouteDetails) {
      foundRoute = routes[i];
      break;
    }
  }

  if (!foundRoute) return null;

  return {
    resource: foundRoute.resource,
    params: foundRouteDetails.params,
  };
}

export async function renderApiRoute(
  request: Request,
  route: ApiRouteMatch,
  log: Logger
): Promise<Response> {
  let response;

  try {
    response = await route.resource(request, {params: route.params});
  } catch (e) {
    log.error(e);
    response = new Response('Error processing: ' + request.url, {status: 500});
  }

  logServerResponse(
    'api',
    log,
    request as ServerComponentRequest,
    response.status
  );

  return response;
}
