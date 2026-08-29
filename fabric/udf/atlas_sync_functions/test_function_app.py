import importlib.util
import pathlib
import sys
import types
import unittest
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


if __name__ == "__main__":
    unittest.main()
