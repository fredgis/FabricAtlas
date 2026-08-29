//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { beforeEach, describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "@/App";
import { AtlasProvider } from "@/atlas/store";
import { ThemeContext } from "@/hooks/theme.context";

function renderApp() {
    return render(
        <ThemeContext.Provider value={{ isDark: false, toggleTheme: () => undefined }}>
            <AtlasProvider isPreview>
                <App />
            </AtlasProvider>
        </ThemeContext.Provider>,
    );
}

describe("App", () => {
    beforeEach(() => {
        window.history.replaceState(null, "", "/#overview");
    });

    it("renders without throwing", () => {
        expect(() => renderApp()).not.toThrow();
    });

    it("mounts content into the document", () => {
        renderApp();
        expect(document.body).not.toBeEmptyDOMElement();
    });

    it("opens the grouped Governance Center from the sidebar", async () => {
        renderApp();
        fireEvent.click(screen.getByRole("button", { name: "Governance Center" }));
        expect(
            await screen.findByRole("heading", { name: "Governance Center" }),
        ).toBeInTheDocument();
    });

    it("opens global search with Ctrl+K", () => {
        renderApp();
        fireEvent.keyDown(window, { key: "k", ctrlKey: true });
        expect(
            screen.getByRole("dialog", { name: "Search Fabric Atlas" }),
        ).toBeInTheDocument();
    });
});
