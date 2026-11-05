export type Theme = "dark" | "light";

export const STORAGE_KEY = "vouch-theme";
export const THEME_COLOR: Record<Theme, string> = { dark: "#111111", light: "#f2f0ea" };

// Runs in the page's head before it paints, so a saved choice never flashes the other theme.
export const THEME_SCRIPT = `try{if(localStorage.getItem("${STORAGE_KEY}")==="dark"){document.documentElement.dataset.theme="dark";document.querySelector('meta[name="theme-color"]')?.setAttribute("content","${THEME_COLOR.dark}")}}catch(e){}`;
