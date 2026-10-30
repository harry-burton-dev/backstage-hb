import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { HomePageWidgetBlueprint } from '@backstage/plugin-home-react/alpha';
import { MarkdownContent } from '@backstage/core-components';

const content = `
## The company's developer portal

Everything we build, who owns it, what it calls and what it stands on.
AUGUR describes itself (\`pnpm catalog\` in im-platform), so nothing here
is kept up by hand.

- **[Catalog](/catalog)**: AUGUR's platform, its apps, their APIs and resources, as on \`dev\`.
- **[APIs](/api-docs)**: the gateway, identity, registry, events and models contracts, and each app's intents.
- **[Docs](/docs)**: AUGUR's guides from \`docs/\`, as one site.
`;

const gettingStartedWidget = HomePageWidgetBlueprint.make({
  name: 'getting-started',
  params: {
    name: 'GettingStarted',
    title: 'Start here',
    description: 'What this portal is for',
    components: async () => ({
      Content: () => <MarkdownContent content={content} />,
    }),
  },
});

export const homeModule = createFrontendModule({
  pluginId: 'home',
  extensions: [gettingStartedWidget],
});
