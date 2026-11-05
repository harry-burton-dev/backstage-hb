import { createBaseThemeOptions, createUnifiedTheme, genPageTheme, palettes, shapes } from '@backstage/theme';

// AUGUR's colours, from platform/packages/ui-kit/tokens/tokens.json in augur. Copy them
// here by hand when the tokens change; the kit's components aren't used, only its palette and type.
const t = {
  slate: '#2A3240',
  slateDeep: '#1C222C',
  navy: '#1E40AF',
  green: '#34D399',
  orgHigh: '#86A0F4',
  orgLow: '#172F7A',
  teamLow: '#C2553F',
  teamHigh: '#F2B24C',
  ink: '#D1D5DB',
  inkMuted: '#9CA3AF',
  danger: '#F87171',
  warning: '#FBBF24',
  success: '#4ADE80',
  info: '#60A5FA',
};

const page = genPageTheme({ colors: [t.navy, t.slateDeep], shape: shapes.wave });

export const augurTheme = createUnifiedTheme({
  ...createBaseThemeOptions({
    palette: {
      ...palettes.dark,
      primary: { main: t.green },
      secondary: { main: t.orgHigh },
      error: { main: t.danger },
      warning: { main: t.warning },
      success: { main: t.success },
      info: { main: t.info },
      background: { default: t.slate, paper: t.slateDeep },
      text: { primary: t.ink, secondary: t.inkMuted },
      link: t.green,
      navigation: {
        background: t.slateDeep,
        indicator: t.green,
        color: t.inkMuted,
        selectedColor: t.ink,
        navItem: { hoverBackground: t.slate },
      },
    },
  }),
  fontFamily: '"Jost", system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
  defaultPageTheme: 'home',
  pageTheme: {
    home: page,
    documentation: genPageTheme({ colors: [t.orgLow, t.slateDeep], shape: shapes.wave2 }),
    tool: genPageTheme({ colors: [t.teamLow, t.slateDeep], shape: shapes.round }),
    service: page,
    website: page,
    library: page,
    other: page,
    app: page,
    apis: genPageTheme({ colors: [t.orgLow, t.slateDeep], shape: shapes.wave }),
  },
});
