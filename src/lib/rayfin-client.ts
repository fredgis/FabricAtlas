//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { RayfinClient } from "@microsoft/rayfin-client";
import { browserSession } from "@microsoft/rayfin-auth";
import { dataService, type EntitySchema } from "@microsoft/rayfin-data";
import { functionsService } from "@microsoft/rayfin-functions";
import type { AppFunctionsSchema } from "../../rayfin/functions/src/types";

function createAtlasClient(config: {
    baseUrl: string;
    publishableKey: string;
    functionsBaseUrl?: string;
}) {
    return RayfinClient.create({
        baseUrl: config.baseUrl,
        publishableKey: config.publishableKey,
        timeout: RAYFIN_REQUEST_TIMEOUT_MS,
        functionsBaseUrl: config.functionsBaseUrl,
        auth: browserSession({ storage: sessionAuthStorage() }),
        services: {
            // The data API stays untyped: backend.ts selects its own fields.
            data: dataService<EntitySchema>(),
            functions: functionsService<AppFunctionsSchema>(),
        },
    });
}

/**
 * Rayfin client with the existing untyped data API and the generated
 * Functions schema for `client.functions.<name>.invoke(...)`.
 */
export type AtlasRayfinClient = ReturnType<typeof createAtlasClient>;

let _client: AtlasRayfinClient | undefined;
const RAYFIN_REQUEST_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sessionAuthStorage(): Storage | false {
    try {
        return window.sessionStorage;
    } catch {
        return false;
    }
}

/**
 * Resolves the local Functions host used while debugging with Vite.
 *
 * Production builds always return `undefined`, so invocations use the
 * deployed backend route. Plain HTTP is accepted only for loopback hosts
 * because the Rayfin access token is sent with every invocation.
 */
function localFunctionsBaseUrl(): string | undefined {
    if (!import.meta.env.DEV) {
        return undefined;
    }

    const configuredUrl = import.meta.env.VITE_RAYFIN_FUNCTIONS_URL?.trim();
    if (!configuredUrl) {
        return undefined;
    }

    const url = URL.canParse(configuredUrl) ? new URL(configuredUrl) : undefined;
    const isHttps = url?.protocol === "https:";
    const isLoopbackHttp = url?.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
    if (!isHttps && !isLoopbackHttp) {
        throw new Error(
            "Invalid VITE_RAYFIN_FUNCTIONS_URL - use an https URL or a loopback http URL such as http://localhost:7071",
        );
    }

    return configuredUrl;
}

/**
 * Returns the pre-configured RayfinClient singleton.
 */
export function getRayfinClient(): AtlasRayfinClient {
    if (!_client) {
        const apiUrl = import.meta.env.VITE_RAYFIN_API_URL;
        const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;

        if (!apiUrl || !publishableKey) {
            throw new Error(`Missing required env vars for creating rayfin client - run 'npx rayfin up'`);
        }

        _client = createAtlasClient({
            baseUrl: apiUrl,
            publishableKey,
            functionsBaseUrl: localFunctionsBaseUrl(),
        });
    }

    return _client;
}