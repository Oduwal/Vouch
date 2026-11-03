export type Theme = "dark" | "light";

export const STORAGE_KEY = "vouch-theme";
export const THEME_COLOR: Record<Theme, string> = { dark: "#3d0012", light: "#ffe8f4" };

// Runs in the page's head before it paints, so a saved choice never flashes the other theme.
export const THEME_SCRIPT = `try{if(localStorage.getItem("${STORAGE_KEY}")==="light"){document.documentElement.dataset.theme="light";document.querySelector('meta[name="theme-color"]')?.setAttribute("content","${THEME_COLOR.light}")}}catch(e){}`;
