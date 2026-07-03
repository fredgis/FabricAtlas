//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from "react-error-boundary";
import { type ReactNode } from "react";

import App from './App.tsx';
import { ErrorFallback } from './ErrorFallback';
import { useAppTheme } from './hooks/use-theme';
import { ThemeContext } from './hooks/theme.context';
import { AuthProvider } from './hooks/use-auth';
import { bootstrapAuth, type IAuthService } from './services/rayfin-auth.service';
import { AuthGate } from './components/auth-gate.component';
import { AtlasProvider } from './atlas/store';

import "./global.css"

// In Fabric the app boots with Rayfin + Fabric auth. Run standalone (no rayfin
// env — e.g. `npm run dev` locally, or the README screenshot build) it drops
// into preview mode backed by the sample dataset instead of throwing.
let rayfinAuthService: IAuthService | null = null;
let previewMode = false;
try {
    rayfinAuthService = bootstrapAuth();
} catch {
    previewMode = true;
}

function ThemeShell({ children }: { children: ReactNode }) {
    const { isDark, toggleTheme } = useAppTheme();
    return (
        <ThemeContext.Provider value={{ isDark, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

function Root() {
    if (previewMode || !rayfinAuthService) {
        return (
            <ThemeShell>
                <ErrorBoundary FallbackComponent={ErrorFallback}>
                    <AtlasProvider isPreview>
                        <App />
                    </AtlasProvider>
                </ErrorBoundary>
            </ThemeShell>
        );
    }

    return (
        <ThemeShell>
            <ErrorBoundary FallbackComponent={ErrorFallback}>
                <AuthProvider rayfinAuthService={rayfinAuthService}>
                    <AuthGate>
                        <AtlasProvider isPreview={false}>
                            <App />
                        </AtlasProvider>
                    </AuthGate>
                </AuthProvider>
            </ErrorBoundary>
        </ThemeShell>
    );
}

createRoot(document.getElementById('root')!).render(<Root />)
