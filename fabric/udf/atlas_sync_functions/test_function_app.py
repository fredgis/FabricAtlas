import datetime
import importlib.util
import io
import json
import pathlib
import sys
import types
import unittest
import urllib.error
from unittest import mock


class _UserDataFunctions:
    def function(self):
        return lambda function: function


fabric_module = types.ModuleType("fabric")
functions_module = types.ModuleType("fabric.functions")
functions_module.UserDataFunctions = _UserDataFunctions
fabric_module.functions = functions_module
sys.modules.setdefault("fabric", fabric_module)
sys.modules.setdefault("fabric.functions", functions_module)

module_path = pathlib.Path(__file__).with_name("function_app.py")
spec = importlib.util.spec_from_file_location("atlas_sync_function_app", module_path)
function_app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(function_app)


class _Response:
    def __init__(self, value):
        self.payload = json.dumps(value).encode("utf-8")
        self.offset = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size=-1):
        if self.offset >= len(self.payload):
            return b""
        if size < 0:
            value = self.payload[self.offset :]
            self.offset = len(self.payload)
            return value
        value = self.payload[self.offset : self.offset + size]
        self.offset += len(value)
        return value


class _Clock:
    def __init__(self, value=0):
        self.value = value
        self.sleeps = []

    def monotonic(self):
        return self.value

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.value += seconds


def _http_error(code, retry_after=None):
    headers = {}
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return urllib.error.HTTPError(
        "https://example.test",
        code,
        "safe test error",
        headers,
        io.BytesIO(),
    )


class LakehouseSchemaTests(unittest.TestCase):
    def test_flattens_schema_enabled_table_payloads(self):
        payload = {
            "data": [
                {
                    "name": "smilesdb",
                    "type": "Schema",
                    "tables": [
                        {"name": "customers", "type": "Managed"},
                        {"name": "orders", "type": "Managed"},
                    ],
                }
            ]
        }

        self.assertEqual(
            [table["name"] for table in function_app._table_records(payload)],
            ["customers", "orders"],
        )

    def test_derives_tables_through_sql_endpoint_metadata(self):
        lakehouse_id = "11111111-1111-4111-8111-111111111111"
        endpoint_id = "22222222-2222-4222-8222-222222222222"
        model_id = "33333333-3333-4333-8333-333333333333"
        arts = [
            {"id": lakehouse_id, "_type": "Lakehouse", "relations": []},
            {
                "id": model_id,
                "_type": "SemanticModel",
                "relations": [{"dependentOnArtifactId": endpoint_id}],
            },
        ]
        schema = {
            lakehouse_id: [
                {
                    "name": "dbo.orders",
                    "objectType": "Managed",
                    "source": "Fabric Lakehouse Tables REST",
                    "columns": [],
                    "measures": [],
                }
            ],
            model_id: [
                {
                    "name": "orders",
                    "columns": [
                        {"name": "order_id", "dataType": "Int64"},
                        {"name": "amount", "dataType": "Decimal"},
                    ],
                    "measures": [{"name": "Revenue"}],
                }
            ]
        }
        detail = {
            "properties": {"sqlEndpointProperties": {"id": endpoint_id}}
        }

        with mock.patch.object(function_app, "_get", return_value=detail):
            function_app._derive_storage_schemas(
                "token",
                "workspace",
                arts,
                schema,
            )

        self.assertEqual(
            schema[lakehouse_id],
            [
                {
                    "name": "dbo.orders",
                    "objectType": "Managed",
                    "source": (
                        "Fabric Lakehouse Tables REST"
                        " + Downstream semantic model"
                    ),
                    "columns": [
                        {"name": "order_id", "dataType": "Int64"},
                        {"name": "amount", "dataType": "Decimal"},
                    ],
                    "measures": [],
                }
            ],
        )

    def test_does_not_repeat_an_unsupported_lakehouse_detail_request(self):
        storage = {
            "id": "lakehouse",
            "_type": "Lakehouse",
            "_detailAttempted": True,
        }

        with mock.patch.object(function_app, "_get") as get:
            endpoint_ids = function_app._storage_endpoint_ids(
                "token",
                "workspace",
                storage,
                [storage],
            )

        self.assertEqual(endpoint_ids, set())
        get.assert_not_called()

    def test_deduplicates_tables_and_preserves_columns(self):
        merged = function_app._merge_schema_tables(
            [
                {
                    "name": "Orders",
                    "columns": [{"name": "order_id", "dataType": "Int64"}],
                }
            ],
            [
                {
                    "name": "orders",
                    "columns": [
                        {"name": "order_id", "dataType": "Int64"},
                        {"name": "amount", "dataType": "Decimal"},
                    ],
                }
            ],
        )

        self.assertEqual(len(merged), 1)
        self.assertEqual(
            [column["name"] for column in merged[0]["columns"]],
            ["order_id", "amount"],
        )

    def test_lakehouse_table_api_paginates(self):
        first_url = (
            "https://api.fabric.microsoft.com/v1/workspaces/workspace/"
            "lakehouses/lake/tables?maxResults=100"
        )
        next_url = first_url + "&continuationToken=next"
        responses = {
            first_url: {
                "data": [{"name": "dbo.orders", "type": "Managed"}],
                "continuationUri": next_url,
            },
            next_url: {
                "data": [{"name": "dbo.customers", "type": "External"}],
            },
        }

        with mock.patch.object(
            function_app,
            "_get",
            side_effect=lambda _token, url: responses[url],
        ):
            tables = function_app._get_all_data(
                "token",
                "/workspaces/workspace/lakehouses/lake/tables?maxResults=100",
            )

        self.assertEqual(
            [table["name"] for table in tables],
            ["dbo.orders", "dbo.customers"],
        )


class ObjectInventoryTests(unittest.TestCase):
    def test_semantic_model_preserves_columns_measures_and_metadata(self):
        schema = function_app._item_schema(
            "token",
            "workspace",
            {
                "tables": [
                    {
                        "name": "Sales",
                        "description": "Sales facts",
                        "isHidden": False,
                        "columns": [
                            {
                                "name": "Amount",
                                "dataType": "Decimal",
                                "description": "Net amount",
                                "isHidden": False,
                            }
                        ],
                        "measures": [
                            {
                                "name": "Revenue",
                                "expression": "SUM(Sales[Amount])",
                                "description": "Total revenue",
                                "isHidden": False,
                            }
                        ],
                    }
                ]
            },
            "SemanticModel",
        )

        self.assertEqual(schema[0]["description"], "Sales facts")
        self.assertEqual(schema[0]["columns"][0]["description"], "Net amount")
        self.assertEqual(
            schema[0]["measures"][0]["expression"],
            "SUM(Sales[Amount])",
        )

    def test_warehouse_uses_scanner_tables_and_views_when_present(self):
        schema = function_app._item_schema(
            "token",
            "workspace",
            {
                "tables": [
                    {
                        "schema": "dbo",
                        "name": "Orders",
                        "columns": [{"name": "Id", "dataType": "Int64"}],
                    }
                ],
                "views": [
                    {
                        "schema": "reporting",
                        "name": "OrderSummary",
                        "columns": [{"name": "Total", "dataType": "Decimal"}],
                    }
                ],
            },
            "Warehouse",
        )

        self.assertEqual(
            [(value["name"], value["objectType"]) for value in schema],
            [("dbo.Orders", "Table"), ("reporting.OrderSummary", "View")],
        )

    def test_sql_database_reports_rest_inventory_limit(self):
        config = function_app._item_config(
            "token",
            "workspace",
            {
                "id": "database",
                "_detail": {
                    "properties": {
                        "databaseName": "Inventory",
                        "collation": "Latin1_General_100_CI_AS",
                    }
                },
            },
            "SQLDatabase",
            [],
        )
        facts = {(row["section"], row["label"]): row["value"] for row in config}

        self.assertEqual(
            facts[("SQL database", "Database name")],
            "Inventory",
        )
        self.assertIn("require SQL connectivity", facts[("Inventory", "Coverage")])

    def test_lakehouse_ignores_malformed_optional_dw_properties(self):
        for value in ("[]", "null", "42"):
            self.assertEqual(
                function_app._metadata_endpoint_ids(
                    {"DwProperties": value}
                ),
                set(),
            )

        config = function_app._item_config(
            "token",
            "workspace",
            {
                "id": "lakehouse",
                "extendedProperties": {"DwProperties": "not-json"},
                "_detail": {},
            },
            "Lakehouse",
            [],
        )
        facts = {(row["section"], row["label"]): row["value"] for row in config}

        self.assertNotIn(("SQL endpoint", "Metadata available"), facts)

        config = function_app._item_config(
            "token",
            "workspace",
            {
                "id": "lakehouse",
                "extendedProperties": {
                    "DwProperties": {"tdsEndpoint": "server.example"}
                },
                "_detail": {},
            },
            "Lakehouse",
            [],
        )
        facts = {(row["section"], row["label"]): row["value"] for row in config}
        self.assertEqual(facts[("SQL endpoint", "Metadata available")], "Yes")

    def test_sql_database_can_expose_a_real_downstream_model_subset(self):
        database_id = "11111111-1111-4111-8111-111111111111"
        model_id = "22222222-2222-4222-8222-222222222222"
        database = {
            "id": database_id,
            "_type": "SQLDatabase",
            "relations": [],
            "_detail": {},
        }
        arts = [
            database,
            {
                "id": model_id,
                "_type": "SemanticModel",
                "relations": [{"dependentOnArtifactId": database_id}],
            },
        ]
        schema = {
            model_id: [
                {
                    "name": "Customers",
                    "columns": [{"name": "Id", "dataType": "Int64"}],
                    "measures": [],
                }
            ]
        }

        function_app._derive_storage_schemas(
            "token",
            "workspace",
            arts,
            schema,
        )

        self.assertEqual(schema[database_id][0]["name"], "Customers")
        self.assertEqual(
            schema[database_id][0]["source"],
            "Downstream semantic model",
        )

    def test_report_pages_are_configured_without_fabricating_visuals(self):
        config = function_app._item_config(
            "token",
            "workspace",
            {
                "id": "report",
                "datasetId": "model",
                "_reportPages": [
                    {
                        "displayName": "Overview",
                        "name": "ReportSection",
                        "order": 0,
                    }
                ],
            },
            "Report",
            [],
        )
        facts = {(row["section"], row["label"]): row["value"] for row in config}

        self.assertEqual(
            facts[("Report pages", "Overview")],
            "ReportSection · order 0",
        )
        self.assertIn(
            "Not exposed",
            facts[("Report", "Visual and binding inventory")],
        )


class RequestReliabilityTests(unittest.TestCase):
    def test_req_returns_json_and_uses_bounded_timeout(self):
        clock = _Clock()
        deadline = function_app._ExecutionDeadline(5, clock.monotonic)

        with mock.patch.object(
            function_app.urllib.request,
            "urlopen",
            return_value=_Response({"ok": True}),
        ) as urlopen:
            result = function_app._req(
                "token",
                "https://example.test",
                deadline=deadline,
                per_request_timeout=20,
            )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 5)

    def test_req_retries_429_and_respects_numeric_retry_after(self):
        clock = _Clock()
        deadline = function_app._ExecutionDeadline(10, clock.monotonic)

        with mock.patch.object(
            function_app.urllib.request,
            "urlopen",
            side_effect=[
                _http_error(429, "2"),
                _Response({"ok": True}),
            ],
        ) as urlopen:
            result = function_app._req(
                "token",
                "https://example.test",
                deadline=deadline,
                sleeper=clock.sleep,
            )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(clock.sleeps, [2])
        self.assertEqual(urlopen.call_count, 2)

    def test_req_respects_http_date_retry_after(self):
        clock = _Clock()
        deadline = function_app._ExecutionDeadline(10, clock.monotonic)
        now = datetime.datetime(
            2026,
            8,
            30,
            9,
            0,
            tzinfo=datetime.timezone.utc,
        )
        retry_at = "Sun, 30 Aug 2026 09:00:03 GMT"

        with mock.patch.object(
            function_app.urllib.request,
            "urlopen",
            side_effect=[
                _http_error(429, retry_at),
                _Response({"ok": True}),
            ],
        ):
            function_app._req(
                "token",
                "https://example.test",
                deadline=deadline,
                sleeper=clock.sleep,
                wall_clock=lambda: now,
            )

        self.assertEqual(clock.sleeps, [3])

    def test_req_retries_transient_5xx_with_capped_backoff(self):
        clock = _Clock()
        deadline = function_app._ExecutionDeadline(30, clock.monotonic)

        with mock.patch.object(
            function_app.urllib.request,
            "urlopen",
            side_effect=[
                _http_error(503),
                _http_error(502),
                _Response({"ok": True}),
            ],
        ):
            function_app._req(
                "token",
                "https://example.test",
                deadline=deadline,
                sleeper=clock.sleep,
            )

        self.assertEqual(clock.sleeps, [0.5, 1.0])

    def test_req_does_not_sleep_past_deadline(self):
        clock = _Clock()
        deadline = function_app._ExecutionDeadline(0.25, clock.monotonic)

        with mock.patch.object(
            function_app.urllib.request,
            "urlopen",
            side_effect=_http_error(503),
        ):
            with self.assertRaises(function_app.DeadlineExceeded):
                function_app._req(
                    "token",
                    "https://example.test",
                    deadline=deadline,
                    sleeper=clock.sleep,
                )

        self.assertEqual(clock.sleeps, [])

    def test_req_does_not_retry_non_transient_4xx(self):
        clock = _Clock()
        deadline = function_app._ExecutionDeadline(10, clock.monotonic)

        with mock.patch.object(
            function_app.urllib.request,
            "urlopen",
            side_effect=_http_error(400),
        ) as urlopen:
            with self.assertRaises(urllib.error.HTTPError):
                function_app._req(
                    "token",
                    "https://example.test",
                    deadline=deadline,
                    sleeper=clock.sleep,
                )

        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(clock.sleeps, [])

    def test_req_rejects_oversized_upstream_payload(self):
        oversized = _Response({"value": "x" * 100})

        with (
            mock.patch.object(
                function_app,
                "MAX_UPSTREAM_RESPONSE_BYTES",
                20,
            ),
            mock.patch.object(
                function_app.urllib.request,
                "urlopen",
                return_value=oversized,
            ),
        ):
            with self.assertRaises(function_app.ResponseSizeExceeded):
                function_app._req(
                    "token",
                    "https://example.test",
                )

    def test_req_enforces_wall_clock_deadline_while_reading(self):
        clock = _Clock()
        deadline = function_app._ExecutionDeadline(20, clock.monotonic)

        class _SlowResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _size=-1):
                clock.value += 3
                return b"1234"

        with (
            mock.patch.object(
                function_app,
                "RESPONSE_READ_CHUNK_BYTES",
                4,
            ),
            mock.patch.object(
                function_app.urllib.request,
                "urlopen",
                return_value=_SlowResponse(),
            ),
        ):
            with self.assertRaises(function_app.DeadlineExceeded):
                function_app._req(
                    "token",
                    "https://example.test",
                    deadline=deadline,
                    per_request_timeout=5,
                )


class MetadataBoundaryTests(unittest.TestCase):
    def test_schema_prefers_finite_row_count_and_strips_business_rows(self):
        schema = function_app._schema_objects(
            [
                {
                    "name": "Sales",
                    "rowCount": 12,
                    "rows": [{"customer": "secret"}],
                    "sourceExpression": "let Source = Sql.Database(...)",
                    "columns": [{"name": "Amount", "values": [99]}],
                    "measures": [
                        {
                            "name": "Revenue",
                            "expression": "SUM(Sales[Amount])",
                            "sourceExpression": "let Source = ...",
                        }
                    ],
                }
            ],
            "Model table",
            "Power BI admin scanner",
            include_measures=True,
        )

        self.assertEqual(schema[0]["rows"], 12)
        self.assertEqual(
            schema[0]["measures"][0]["expression"],
            "SUM(Sales[Amount])",
        )
        serialized = json.dumps(schema)
        self.assertNotIn("customer", serialized)
        self.assertNotIn("sourceExpression", serialized)
        self.assertNotIn("Sql.Database", serialized)

    def test_schema_rejects_non_numeric_negative_and_non_finite_rows(self):
        unsafe_values = [
            [{"business": "row"}],
            {"business": "row"},
            "100",
            -1,
            float("inf"),
            float("nan"),
            True,
        ]
        for index, unsafe in enumerate(unsafe_values):
            with self.subTest(index=index):
                schema = function_app._schema_objects(
                    [{"name": "Unsafe", "rowCount": unsafe}],
                    "Table",
                    "scanner",
                )
                self.assertNotIn("rows", schema[0])

    def test_row_count_presence_prevents_fallback_to_rows(self):
        schema = function_app._schema_objects(
            [{"name": "Unsafe", "rowCount": "bad", "rows": 42}],
            "Table",
            "scanner",
        )
        self.assertNotIn("rows", schema[0])

    def test_metadata_maps_authoritative_fields_without_owner_invention(self):
        metadata = function_app._metadata_for_item(
            {
                "configuredBy": "builder@example.com",
                "modifiedBy": {"emailAddress": "editor@example.com"},
                "modifiedDateTime": "2026-08-30T10:00:00+02:00",
                "endorsementDetails": {
                    "endorsement": "Certified",
                    "certifiedBy": "certifier@example.com",
                },
                "sensitivityLabel": {
                    "labelId": "label-id",
                    "name": "Confidential",
                },
                "tags": [{"id": "tag-id", "name": "finance"}],
                "owner": {"email": "must-not-be-invented@example.com"},
            },
            True,
        )

        self.assertEqual(metadata["configuredBy"], "builder@example.com")
        self.assertEqual(metadata["modifiedBy"], "editor@example.com")
        self.assertEqual(
            metadata["modifiedDateTime"],
            "2026-08-30T08:00:00.000Z",
        )
        self.assertEqual(
            metadata["endorsement"],
            {
                "value": "Certified",
                "certifiedBy": "certifier@example.com",
            },
        )
        self.assertEqual(metadata["sensitivity"]["labelId"], "label-id")
        self.assertEqual(metadata["tags"], [
            {"id": "tag-id", "displayName": "finance"}
        ])
        self.assertNotIn("owner", metadata)

    def test_item_ids_are_normalized_for_stable_metadata_keys(self):
        item = function_app._sanitize_item({
            "id": "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            "type": "SemanticModel",
        })
        self.assertEqual(
            item["id"],
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        )

    def test_metadata_maps_only_documented_type_specific_owner_fields(self):
        model = function_app._metadata_for_item(
            {
                "_type": "SemanticModel",
                "configuredBy": "owner@example.com",
            },
            True,
        )
        report = function_app._metadata_for_item(
            {
                "_type": "Report",
                "createdBy": "report.owner@example.com",
                "createdById": "report-owner-id",
            },
            True,
        )
        generic = function_app._metadata_for_item(
            {
                "_type": "Lakehouse",
                "configuredBy": "not-a-documented-owner@example.com",
            },
            True,
        )

        self.assertEqual(
            model["owner"],
            {
                "source": "workspaceInfo.configuredBy",
                "displayName": "owner@example.com",
                "email": "owner@example.com",
            },
        )
        self.assertEqual(
            report["owner"],
            {
                "source": "workspaceInfo.createdBy",
                "principalId": "report-owner-id",
                "displayName": "report.owner@example.com",
                "email": "report.owner@example.com",
            },
        )
        self.assertNotIn("owner", generic)

    def test_absent_metadata_fields_remain_absent(self):
        self.assertEqual(
            function_app._metadata_for_item({"id": "model"}, True),
            {
                "scannerMatched": True,
                "ownerAvailable": False,
            },
        )

    def test_response_size_guard_fails_closed(self):
        with self.assertRaises(function_app.ResponseSizeExceeded):
            function_app._guard_response_size(
                {"items": ["0123456789"]},
                max_bytes=10,
            )

    def test_response_size_guard_accepts_small_payload(self):
        payload = {"items": []}
        self.assertIs(
            function_app._guard_response_size(payload, max_bytes=100),
            payload,
        )


class LineageTests(unittest.TestCase):
    def test_uses_only_official_id_based_lineage_and_deduplicates(self):
        artifacts = [
            {"id": "flow", "_type": "Dataflow", "displayName": "Shared"},
            {
                "id": "model",
                "_type": "SemanticModel",
                "displayName": "Shared",
                "upstreamDataflows": [
                    {"targetDataflowId": "flow"},
                    {"targetDataflowId": "flow"},
                ],
            },
            {
                "id": "report",
                "_type": "Report",
                "datasetId": "model",
                "relations": [
                    {
                        "dependentOnArtifactId": "model",
                        "relationType": "Datasource",
                    }
                ],
            },
            {
                "id": "dashboard",
                "_type": "Dashboard",
                "tiles": [
                    {"reportId": "report", "datasetId": "model"},
                    {"reportId": "outside", "datasetId": "outside"},
                ],
            },
        ]

        lineage = function_app._official_lineage(
            artifacts,
            {"flow", "model", "report", "dashboard"},
        )

        self.assertIn(
            {"source": "flow", "target": "model", "relation": "dataflow"},
            lineage,
        )
        self.assertIn(
            {"source": "model", "target": "report", "relation": "report"},
            lineage,
        )
        self.assertIn(
            {
                "source": "report",
                "target": "dashboard",
                "relation": "dashboard report",
            },
            lineage,
        )
        self.assertIn(
            {
                "source": "model",
                "target": "dashboard",
                "relation": "dashboard dataset",
            },
            lineage,
        )
        self.assertEqual(
            sum(
                edge["source"] == "flow" and edge["target"] == "model"
                for edge in lineage
            ),
            1,
        )
        self.assertFalse(any(edge["source"] == "outside" for edge in lineage))


class SyncOrchestrationTests(unittest.TestCase):
    workspace_id = "11111111-1111-4111-8111-111111111111"

    def _run_sync(
        self,
        items,
        scan,
        role_assignments=None,
        jobs_error=None,
    ):
        role_assignments = role_assignments or [
            {
                "role": "Admin",
                "principal": {
                    "id": "admin-id",
                    "displayName": "Administrator",
                    "type": "User",
                },
            }
        ]

        def get_all(_token, path):
            if path.endswith("/items"):
                return items
            if path.endswith("/roleAssignments"):
                return role_assignments
            if "/jobs/instances" in path:
                if jobs_error:
                    raise jobs_error
                return []
            raise AssertionError(path)

        with (
            mock.patch.object(
                function_app,
                "_get",
                return_value={
                    "id": self.workspace_id,
                    "displayName": "Atlas workspace",
                },
            ),
            mock.patch.object(
                function_app,
                "_get_all",
                side_effect=get_all,
            ),
            mock.patch.object(
                function_app,
                "_scan_workspace",
                return_value=scan,
            ),
        ):
            return function_app.sync_all("token", self.workspace_id)

    def test_sync_all_returns_v2_envelope_and_keeps_top_level_items(self):
        items = [
            {
                "id": "flow",
                "type": "Dataflow",
                "displayName": "Flow",
                "businessRows": [{"secret": True}],
            },
            {
                "id": "model",
                "type": "SemanticModel",
                "displayName": "Model",
            },
            {
                "id": "dashboard",
                "type": "Dashboard",
                "displayName": "Dashboard",
            },
            {
                "id": "unknown",
                "type": "FutureFabricItem",
                "displayName": "Future",
            },
        ]
        scan = {
            "dataflows": [{"objectId": "flow"}],
            "datasets": [
                {
                    "id": "model",
                    "tables": [
                        {
                            "name": "Sales",
                            "rows": [{"secret": "business row"}],
                            "measures": [
                                {
                                    "name": "Revenue",
                                    "expression": "SUM(Sales[Amount])",
                                }
                            ],
                        }
                    ],
                    "upstreamDataflows": [
                        {"targetDataflowId": "flow"}
                    ],
                    "users": [
                        {
                            "graphId": "principal-id",
                            "displayName": "Reader",
                            "principalType": "User",
                            "datasetUserAccessRight": "Read",
                        },
                        {
                            "identifier": "EntireTenant",
                            "displayName": "EntireTenant",
                            "principalType": "None",
                            "userType": "EntireTenant",
                            "datasetUserAccessRight": "Read",
                        },
                    ],
                    "configuredBy": "builder@example.com",
                    "modifiedBy": "editor@example.com",
                    "endorsementDetails": {
                        "endorsement": "Certified",
                        "certifiedBy": "certifier@example.com",
                    },
                    "sensitivityLabel": {"labelId": "label-id"},
                    "tags": [{"id": "tag-id"}],
                }
            ],
            "dashboards": [
                {
                    "id": "dashboard",
                    "tiles": [{"datasetId": "model"}],
                }
            ],
        }

        result = self._run_sync(items, scan)

        self.assertEqual(result["schemaVersion"], 2)
        self.assertEqual(
            result["capabilities"],
            {
                "endorsement": {"status": "complete"},
                "sensitivity": {"status": "complete", "code": "label-ids"},
                "tags": {"status": "complete", "code": "tag-ids"},
                "ownership": {"status": "complete", "code": "type-specific"},
            },
        )
        self.assertEqual(
            [item["id"] for item in result["items"]],
            ["flow", "model", "dashboard", "unknown"],
        )
        self.assertNotIn("businessRows", result["items"][0])
        self.assertEqual(
            result["schema"]["model"][0]["measures"][0]["expression"],
            "SUM(Sales[Amount])",
        )
        self.assertNotIn("rows", result["schema"]["model"][0])
        self.assertEqual(
            result["itemMetadata"]["model"]["configuredBy"],
            "builder@example.com",
        )
        self.assertEqual(result["access"][0]["principalId"], "principal-id")
        self.assertEqual(result["access"][1]["principalId"], "entire-tenant")
        self.assertTrue(result["access"][1]["tenantWide"])
        self.assertIn(
            {"source": "flow", "target": "model", "relation": "dataflow"},
            result["lineage"],
        )
        for section in (
            "workspace",
            "items",
            "roleAssignments",
            "scanner",
            "schema",
            "lineage",
            "access",
            "config",
        ):
            self.assertEqual(
                result["sections"][section]["status"],
                "complete",
            )
        self.assertEqual(
            set(result["sections"]),
            {
                "workspace",
                "items",
                "roleAssignments",
                "scanner",
                "schema",
                "lineage",
                "access",
                "config",
                "jobs",
                "itemDetails",
                "lakehouseTables",
                "reportPages",
            },
        )
        serialized = json.dumps(result)
        self.assertNotIn("business row", serialized)
        self.assertNotIn("datasourceDetails", serialized)
        self.assertNotIn("datasetExpressions", serialized)

    def test_empty_successful_workspace_has_complete_required_sections(self):
        result = self._run_sync([], {})

        self.assertEqual(result["items"], [])
        self.assertEqual(result["schema"], {})
        self.assertEqual(result["lineage"], [])
        self.assertEqual(result["access"], [])
        self.assertEqual(result["config"], [])
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["sections"]["scanner"]["status"], "complete")
        self.assertEqual(result["sections"]["schema"]["status"], "complete")

    def test_optional_unsupported_jobs_do_not_fail_required_snapshot(self):
        result = self._run_sync(
            [
                {
                    "id": "model",
                    "type": "SemanticModel",
                    "displayName": "Model",
                }
            ],
            {"datasets": [{"id": "model", "tables": []}]},
            jobs_error=_http_error(404),
        )

        self.assertEqual(
            result["sections"]["jobs"],
            {"status": "unsupported", "code": "endpoint-unsupported"},
        )
        self.assertEqual(result["sections"]["scanner"]["status"], "complete")
        self.assertEqual(result["sections"]["config"]["status"], "complete")
        self.assertEqual(result["errors"], [])

    def test_optional_transient_job_failure_uses_safe_code(self):
        result = self._run_sync(
            [
                {
                    "id": "model",
                    "type": "SemanticModel",
                    "displayName": "Model",
                }
            ],
            {"datasets": [{"id": "model", "tables": []}]},
            jobs_error=_http_error(503),
        )

        self.assertEqual(
            result["sections"]["jobs"],
            {"status": "failed", "code": "transient-upstream"},
        )
        self.assertEqual(result["errors"], ["jobs: transient-upstream"])
        self.assertNotIn("safe test error", json.dumps(result))

    def test_scanner_failure_marks_required_sections_with_safe_errors(self):
        with (
            mock.patch.object(
                function_app,
                "_get",
                return_value={
                    "id": self.workspace_id,
                    "displayName": "Atlas workspace",
                },
            ),
            mock.patch.object(
                function_app,
                "_get_all",
                side_effect=lambda _token, path: (
                    []
                    if path.endswith("/items")
                    else [
                        {
                            "role": "Admin",
                            "principal": {
                                "id": "admin",
                                "displayName": "Admin",
                                "type": "User",
                            },
                        }
                    ]
                ),
            ),
            mock.patch.object(
                function_app,
                "_scan_workspace",
                side_effect=RuntimeError("secret tenant detail"),
            ),
        ):
            result = function_app.sync_all("token", self.workspace_id)

        self.assertEqual(result["sections"]["scanner"]["status"], "failed")
        self.assertEqual(result["sections"]["access"]["status"], "failed")
        self.assertEqual(
            result["capabilities"]["endorsement"],
            {"status": "failed", "code": "upstream-failure"},
        )
        self.assertEqual(
            result["capabilities"]["ownership"],
            {"status": "failed", "code": "upstream-failure"},
        )
        self.assertNotIn("secret tenant detail", json.dumps(result))


class OptionalEndpointStatusTests(unittest.TestCase):
    def _trackers(self):
        return {
            "itemDetails": function_app._new_optional_tracker(),
            "lakehouseTables": function_app._new_optional_tracker(),
            "reportPages": function_app._new_optional_tracker(),
        }

    def test_lakehouse_optional_404s_are_unsupported_not_failed(self):
        trackers = self._trackers()
        errors = []
        with (
            mock.patch.object(
                function_app,
                "_get",
                side_effect=_http_error(404),
            ),
            mock.patch.object(
                function_app,
                "_get_all_data",
                side_effect=_http_error(404),
            ),
        ):
            function_app._enrich_artifact(
                "token",
                "workspace",
                {"id": "lake", "_type": "Lakehouse"},
                trackers,
                errors,
            )

        out = {"sections": {}, "errors": errors}
        function_app._finish_optional_section(
            out,
            "itemDetails",
            trackers["itemDetails"],
        )
        function_app._finish_optional_section(
            out,
            "lakehouseTables",
            trackers["lakehouseTables"],
        )
        self.assertEqual(
            out["sections"]["itemDetails"]["status"],
            "unsupported",
        )
        self.assertEqual(
            out["sections"]["lakehouseTables"]["status"],
            "unsupported",
        )
        self.assertEqual(errors, [])

    def test_paginated_report_pages_are_explicitly_unsupported(self):
        trackers = self._trackers()
        errors = []
        function_app._enrich_artifact(
            "token",
            "workspace",
            {
                "id": "report",
                "_type": "Report",
                "reportType": "PaginatedReport",
            },
            trackers,
            errors,
        )
        out = {"sections": {}, "errors": errors}
        function_app._finish_optional_section(
            out,
            "reportPages",
            trackers["reportPages"],
        )
        self.assertEqual(
            out["sections"]["reportPages"],
            {"status": "unsupported", "code": "report-type-unsupported"},
        )
        self.assertEqual(errors, [])

    def test_report_page_5xx_is_failed_with_safe_code(self):
        trackers = self._trackers()
        errors = []
        with mock.patch.object(
            function_app,
            "_get",
            side_effect=_http_error(503),
        ):
            function_app._enrich_artifact(
                "token",
                "workspace",
                {"id": "report", "_type": "Report"},
                trackers,
                errors,
            )
        out = {"sections": {}, "errors": errors}
        function_app._finish_optional_section(
            out,
            "reportPages",
            trackers["reportPages"],
        )
        self.assertEqual(
            out["sections"]["reportPages"],
            {"status": "failed", "code": "transient-upstream"},
        )
        self.assertEqual(errors, ["reportPages: transient-upstream"])


class PaginationAndScannerOptionTests(unittest.TestCase):
    def test_value_pagination_supports_continuation_uri(self):
        first = "https://api.fabric.microsoft.com/v1/items"
        second = first + "?continuationToken=next"
        responses = {
            first: {"value": [{"id": "one"}], "continuationUri": second},
            second: {"value": [{"id": "two"}]},
        }
        with mock.patch.object(
            function_app,
            "_get",
            side_effect=lambda _token, url: responses[url],
        ):
            values = function_app._get_all("token", "/items")
        self.assertEqual([value["id"] for value in values], ["one", "two"])

    def test_scanner_request_excludes_sensitive_unused_options(self):
        calls = []

        def request(_token, url, method="GET", body=None):
            calls.append((url, method, body))
            return {"id": "scan-id"}

        def get(_token, url):
            if "/scanStatus/" in url:
                return {"status": "Succeeded"}
            return {"workspaces": [{"id": "workspace"}]}

        with (
            mock.patch.object(function_app, "_req", side_effect=request),
            mock.patch.object(function_app, "_get", side_effect=get),
        ):
            function_app._scan_workspace("token", "workspace")

        scanner_url = calls[0][0]
        self.assertIn("datasetSchema=True", scanner_url)
        self.assertIn("datasetExpressions=True", scanner_url)
        self.assertIn("lineage=True", scanner_url)
        self.assertIn("getArtifactUsers=True", scanner_url)
        self.assertNotIn("datasourceDetails", scanner_url)


if __name__ == "__main__":
    unittest.main()
