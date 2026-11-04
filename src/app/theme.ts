import { createTheme, alpha } from "@mui/material/styles";
import type { TypographyOptions } from "@mui/material/styles/createTypography";
import "@fontsource/cinzel/600.css";

const fontFamily = "Prompt";
/** A serif in the spirit of ELDEN RING's titles, for headings */
const headingFontFamily = `Cinzel, Georgia, serif`;

const fontDefinition = [
  {
    fontFamily,
    fontStyle: "normal",
    fontWeight: 500,
    fontDisplay: "swap",
    src: `url(/prompt-v10-latin-medium.woff2) format("woff2")`,
  },
];

/** Black and gold */
export const colors = {
  background: "#0a0908",
  /** Panels, and the chart surface (its palette is validated against this) */
  surface: "#14120f",
  /** Raised surfaces like tooltips */
  surfaceRaised: "#201c16",
  gold: "#c9a45c",
  goldLight: "#e3c789",
  goldDark: "#8a6d34",
  /** Panel borders and dividers */
  border: alpha("#c9a45c", 0.22),
  text: "#ece4d3",
  textSecondary: "#a89c84",
};

const typography: TypographyOptions = {
  fontFamily: `${fontFamily}, sans-serif`,
  h1: {
    fontFamily: headingFontFamily,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: colors.goldLight,
    fontSize: "1.375rem",
    "@media (min-width: 600px)": {
      fontSize: "1.75rem",
    },
  },
  h6: {
    fontFamily: headingFontFamily,
    fontWeight: 600,
    letterSpacing: "0.03em",
    color: colors.goldLight,
  },
  button: {
    textTransform: "none",
  },
  overline: {
    textTransform: "none",
  },
  fontWeightLight: 500,
  fontWeightRegular: 500,
  fontWeightMedium: 500,
  fontWeightBold: 500,
};

export default createTheme({
  palette: {
    mode: "dark",
    divider: colors.border,
    text: {
      primary: colors.text,
      secondary: colors.textSecondary,
    },
    primary: {
      main: colors.gold,
      light: colors.goldLight,
      dark: colors.goldDark,
    },
    secondary: {
      main: "#9c7a4a",
    },
    background: {
      paper: colors.surface,
      default: colors.background,
    },
  },
  typography,
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: `1px solid ${colors.border}`,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: colors.surfaceRaised,
          border: `1px solid ${colors.border}`,
          color: colors.text,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        "@font-face": fontDefinition,
        body: {
          minHeight: "100vh",
          // A faint warm glow at the top, fading to black
          backgroundImage: `radial-gradient(
            ellipse at 50% -10%,
            ${alpha("#5a4523", 0.35)} 0%,
            ${alpha("#5a4523", 0.08)} 40%,
            ${alpha("#5a4523", 0)} 70%
          )`,
          backgroundAttachment: "fixed",
        },
        "::selection": {
          backgroundColor: colors.gold,
          color: colors.background,
        },
      },
    },
  },
});
