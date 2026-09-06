import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";

/**
 * EZVeploy world theme — "the box wall".
 * Auto light/dark: surfaces + component tokens are light-dark() pairs keyed
 * to prefers-color-scheme (darkModeSelector "system"). The BOARD exterior
 * (masthead, shelf headers, page ground) is painted by world CSS in
 * assets/main.css with the same pairs — see the direction contract in
 * ui/index.html.
 */

// Kraft ramp for the LIGHT scheme's board chrome (masthead/shelves/ground).
// The charred `board` ramp stays the dark scheme's chrome.
const board = {
  0: "#171006",
  50: "#20140a",
  100: "#2a1b0e",
  200: "#372416",
  300: "#46301c",
  400: "#5a4028",
  500: "#6f5136",
  600: "#876548",
  700: "#a18469",
  800: "#c0a68b",
  900: "#e0cbb0",
  950: "#f4e7d6",
};

const boardLight = {
  0: "#8a7449",
  50: "#96804f",
  100: "#a28a5e",
  200: "#b39b6e",
  300: "#b39b6e",
  400: "#b39b6e",
  500: "#a28a5e",
  600: "#96804f",
  700: "#c9b182",
  800: "#d4bd8f",
  900: "#ece0c2",
  950: "#f4e7d6",
};

// Dark-scheme tissue ramp: warm near-black surfaces (0 = deepest interior),
// lightening toward the top for inverted-text steps.
const tissueDark = {
  0: "#241b10",
  50: "#2a2014",
  100: "#32261a",
  200: "#3b2d1f",
  300: "#463726",
  400: "#574531",
  500: "#6b573f",
  600: "#836c48",
  700: "#a0875e",
  800: "#b89e73",
  900: "#cdb38a",
  950: "#e6d7b6",
};

const tissue = {
  0: "#fdf7ec",
  50: "#faf1df",
  100: "#f4e7cf",
  200: "#ebdab9",
  300: "#decaa4",
  400: "#cdb38a",
  500: "#b89e73",
  600: "#a0875e",
  700: "#836c48",
  800: "#645136",
  900: "#463726",
  950: "#2e241a",
};

const orange = {
  50: "#fff3e4",
  100: "#ffe1c4",
  200: "#ffca92",
  300: "#f7ac5e",
  400: "#ee913a",
  500: "#e0761e",
  600: "#c9610d",
  700: "#a84e08",
  800: "#833b05",
  900: "#5c2803",
  950: "#401b02",
};

const ink = {
  0: "#ffffff",
  50: "#f6eedd",
  100: "#eadfc2",
  300: "#c9b48c",
  500: "#9c8662",
  700: "#6b573f",
  900: "#33240f",
  950: "#1c1208",
};

export const palette = { board, boardLight, tissue, tissueDark, orange, ink };

export const ezveployTheme = definePreset(Aura, {
  primitive: { board, boardLight, tissue, tissueDark, orange, ink },
  semantic: {
    primary: {
      50: "{orange.50}",
      100: "{orange.100}",
      200: "{orange.200}",
      300: "{orange.300}",
      400: "{orange.400}",
      500: "{orange.500}",
      600: "{orange.600}",
      700: "{orange.700}",
      800: "{orange.800}",
      900: "{orange.900}",
      950: "{orange.950}",
    },
    surface: {
      0: "light-dark({tissue.0},{tissueDark.0})",
      50: "light-dark({tissue.50},{tissueDark.50})",
      100: "light-dark({tissue.100},{tissueDark.100})",
      200: "light-dark({tissue.200},{tissueDark.200})",
      300: "light-dark({tissue.300},{tissueDark.300})",
      400: "light-dark({tissue.400},{tissueDark.400})",
      500: "light-dark({tissue.500},{tissueDark.500})",
      600: "light-dark({tissue.600},{tissueDark.600})",
      700: "light-dark({tissue.700},{tissueDark.700})",
      800: "light-dark({tissue.800},{tissueDark.800})",
      900: "light-dark({tissue.900},{tissueDark.900})",
      950: "light-dark({tissue.950},{tissueDark.950})",
    },
    focusRing: {
      width: "2px",
      style: "solid",
      color: "{primary.color}",
      offset: "1px",
      shadow: "none",
    },
  },
  components: {
    button: {
      root: {
        paddingX: "1rem",
        paddingY: "0.5rem",
        borderRadius: "4px",
        fontFamily:
          "'DejaVu Sans Condensed', 'Arial Narrow', 'DejaVu Sans', sans-serif",
        fontWeight: "600",
        letterSpacing: "0.02em",
        primary: {
          background: "{primary.color}",
          hoverBackground: "{primary.400}",
          activeBackground: "{primary.600}",
          borderColor: "{primary.color}",
          hoverBorderColor: "{primary.400}",
          activeBorderColor: "{primary.600}",
          color: "{ink.900}",
          hoverColor: "{ink.900}",
          activeColor: "{ink.900}",
        },
      },
    },
    tabmenu: {
      tablist: {
        borderColor: "transparent",
      },
    },
    datatable: {
      row: {
        borderColor: "light-dark({ink.300},{tissueDark.500})",
      },
      bodyCell: {
        borderColor: "light-dark({tissue.300},{tissueDark.400})",
        padding: "0.625rem 0.875rem",
      },
      headerCell: {
        background: "light-dark({tissue.100},{tissueDark.300})",
        color: "light-dark({ink.900},{ink.50})",
        padding: "0.625rem 0.875rem",
      },
    },
    inputtext: {
      root: {
        paddingX: "0.75rem",
        paddingY: "0.5rem",
      },
    },
    dropdown: {
      root: {
        paddingX: "0.75rem",
        paddingY: "0.5rem",
      },
    },
  },
});
