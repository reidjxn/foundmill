---
key: api_reference
name: API reference docs
description: Documents endpoints with parameters, examples taken from passing tests and every error a caller can get.
category: engineering
attribute_name: API documentation
attribute_group: craft
when_to_use: Use when an API needs reference pages: endpoints, parameters, examples and every error a caller can get.
roles: docs_writer, backend_engineer
default_for:
stage: idea, building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: original
license_note: original
improves: technical_writing, example_quality
version: 2
---
# API reference docs

For each endpoint, document in this order:

- Method, path and a one-line purpose.
- Authentication and the permission it needs.
- Parameters in a table: name, type, required, default, description.
- One request and response example taken from a real test run, with secrets replaced by placeholders.
- Every error status with its cause and how the caller fixes it.
- Rate limits and pagination where they apply.

Take each example from a passing test or mark it "not run". Note the version the page describes.
