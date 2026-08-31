import type { ThemeConfig } from "antd/es/config-provider";

/** Aronium theme: sober corporate blue as the primary accent (replacing the
 * previous black/neutral-900 primary), matching Aronium POS's desktop look.
 * Matches app `tailwind` neutral scale and input chrome. */
const neutral900 = "#171717";
const neutral800 = "#262626";
const neutral700 = "#404040";
const neutral500 = "#737373";
const neutral200 = "#e5e5e5";
const neutral100 = "#f5f5f5";
const white = "#ffffff";
const warning500 = "#FFA514";
const primary600 = "#1976C2";
const primary700 = "#125E9E";
const primary100 = "#E3F1FC";
const primary200 = "#BEE0F8";
const aroniumFontFamily = '"Segoe UI", "Urbanist", -apple-system, BlinkMacSystemFont, Roboto, sans-serif';

export const appAntdTheme: ThemeConfig = {
  token: {
    colorPrimary: primary600,
    colorInfo: primary600,
    colorSuccess: "#3DE567",
    colorWarning: warning500,
    colorError: "#F43A30",
    colorText: neutral700,
    colorTextSecondary: neutral500,
    colorTextPlaceholder: neutral500,
    colorBgContainer: white,
    colorBorder: neutral900,
    colorSplit: neutral200,
    borderRadius: 6,
    borderRadiusLG: 6,
    fontFamily: aroniumFontFamily,
    fontFamilyCode: aroniumFontFamily,
    controlHeight: 40,
    controlHeightLG: 48,
    controlOutline: "transparent",
    controlOutlineWidth: 0,
    lineWidth: 2,
    lineWidthFocus: 2
  },
  components: {
    DatePicker: {
      colorPrimary: primary600,
      colorBgElevated: white,
      colorBorder: neutral900,
      hoverBorderColor: neutral800,
      activeBorderColor: primary600,
      activeShadow: "none",
      errorActiveShadow: "none",
      warningActiveShadow: "none",
      cellHoverBg: primary100,
      cellActiveWithRangeBg: primary200,
      cellHoverWithRangeBg: primary200,
      cellRangeBorderColor: primary600,
      cellBgDisabled: neutral100,
      multipleItemBg: neutral100,
      presetsMaxWidth: 200,
    },
    Calendar: {
      fullBg: "transparent",
      fullPanelBg: white,
      itemActiveBg: primary600,
      colorPrimary: primary600,
    },
    Select: {
      optionSelectedBg: primary100,
      optionSelectedColor: primary700
    },
    Button: {
      primaryColor: white,
      ghostBg: primary600
    }
  },
};
