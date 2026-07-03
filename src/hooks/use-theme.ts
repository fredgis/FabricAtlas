//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useState, useEffect } from "react";

/**
 * Detects the current color scheme preference and toggles the `dark`
 * class on `<html>`. Listens for changes to `prefers-color-scheme` and
 * the `data-appearance` attribute on `<html>`.
 */
export function useAppTheme() {
    const [isDark, setIsDark] = useState(() => {
        // Host (Fabric portal) can force a theme via data-appearance.
        const appearance = document.documentElement.getAttribute("data-appearance");
        if (appearance === "dark") return true;
        if (appearance === "light") return false;
        if (document.documentElement.classList.contains("dark")) return true;
        // Light is the standard/default theme; the host can still force dark.
        return false;
    });

    useEffect(() => {
        // Sync the .dark class on <html> for Tailwind dark mode
        document.documentElement.classList.toggle("dark", isDark);
    }, [isDark]);

    useEffect(() => {
        // Follow the host's data-appearance attribute only (not the OS), so the
        // app stays white by default and matches the Fabric portal when embedded.
        const observer = new MutationObserver(() => {
            const appearance = document.documentElement.getAttribute("data-appearance");
            if (appearance === "dark") setIsDark(true);
            else if (appearance === "light") setIsDark(false);
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-appearance"],
        });

        return () => observer.disconnect();
    }, []);

    const toggleTheme = () => setIsDark((prev: boolean) => !prev);

    return { isDark, toggleTheme };
}
