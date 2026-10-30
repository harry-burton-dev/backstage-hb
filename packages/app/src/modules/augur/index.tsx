import {
  ApiBlueprint,
  configApiRef,
  createApiFactory,
  createApiRef,
  createFrontendModule,
  discoveryApiRef,
  oauthRequestApiRef,
  useApi,
  type BackstageIdentityApi,
  type OpenIdConnectApi,
  type ProfileInfoApi,
  type SessionApi,
} from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint, ThemeBlueprint, type SignInPageProps } from '@backstage/plugin-app-react';
import { OAuth2 } from '@backstage/core-app-api';
import { SignInPage } from '@backstage/core-components';
import { UnifiedThemeProvider } from '@backstage/theme';
import { augurTheme } from './theme';
import { channelsCard, deploymentCard } from './pipeline';

/** Sign-in through Keycloak, as the auth backend's `oidc` provider (app-config.production.yaml). */
export const keycloakAuthApiRef = createApiRef<
  OpenIdConnectApi & ProfileInfoApi & BackstageIdentityApi & SessionApi
>({ id: 'auth.keycloak' });

const keycloakAuthApi = ApiBlueprint.make({
  name: 'keycloak',
  params: defineParams =>
    defineParams(
      createApiFactory({
        api: keycloakAuthApiRef,
        deps: { discoveryApi: discoveryApiRef, oauthRequestApi: oauthRequestApiRef, configApi: configApiRef },
        factory: ({ discoveryApi, oauthRequestApi, configApi }) =>
          OAuth2.create({
            configApi,
            discoveryApi,
            oauthRequestApi,
            provider: { id: 'oidc', title: 'AUGUR sign-in', icon: () => null },
            environment: configApi.getOptionalString('auth.environment'),
            defaultScopes: ['openid', 'profile', 'email'],
          }),
      }),
    ),
});

/** Keycloak on the server; a guest when running locally with `yarn start`. */
function AugurSignInPage(props: SignInPageProps) {
  const config = useApi(configApiRef);
  const onServer = config.getOptionalString('auth.environment') === 'production';
  return (
    <SignInPage
      {...props}
      title="Backstage"
      align="center"
      providers={
        onServer
          ? [
              {
                id: 'keycloak',
                title: 'AUGUR sign-in',
                message: 'Sign in with your AUGUR account.',
                apiRef: keycloakAuthApiRef,
              },
            ]
          : ['guest']
      }
    />
  );
}

const signInPage = SignInPageBlueprint.make({
  params: { loader: async () => AugurSignInPage },
});

const theme = ThemeBlueprint.make({
  name: 'augur',
  params: {
    theme: {
      id: 'augur',
      title: 'AUGUR',
      variant: 'dark',
      Provider: ({ children }) => <UnifiedThemeProvider theme={augurTheme} children={children} />,
    },
  },
});

export const augurModule = createFrontendModule({
  pluginId: 'app',
  extensions: [keycloakAuthApi, signInPage, theme],
});

/** AUGUR's cards on the catalog's entity pages: each unit's channels, and each deployment (pipeline.tsx). */
export const augurCatalogModule = createFrontendModule({
  pluginId: 'catalog',
  extensions: [channelsCard, deploymentCard],
});
