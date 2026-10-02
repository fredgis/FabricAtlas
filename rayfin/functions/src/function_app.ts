import { UserDataFunctions } from '@microsoft/fabric-user-data-functions';
import { createPingResult, type PingResult } from './ping.js';

const udf = new UserDataFunctions();

/** Bounded health probe with no secrets, external calls or data writes. */
udf.func('ping', (): PingResult => createPingResult(), []);
