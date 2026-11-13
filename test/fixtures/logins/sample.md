# PMS login credentials (fixture)

Fictional accounts for the unit tests of the "Credenziali" panel (test/unit/browser-credentials.test.ts): same shape as
the user's ops/credentials.md, no real secret.

```json
{
  "ExampleApp": {
    "prod": [
      { "note": "Prodotto A PROD holding demo", "email": "prod.user@example.com", "password": "fake-prod-1" }
    ],
    "test": [
      { "email": "mario@example.com", "password": "fake-test-1" },
      { "note": "holding with module X enabled\n(for module X checks)", "url": "https://test-3.example.test/Account/Login", "email": "qa.user@example.com", "password": "fake-test-2" }
    ],
    "local": [
      { "note": "local stack", "url": "https://localhost:44300/", "email": "admin@localhost.test", "password": "fake-local-1" }
    ]
  },
  "sistemaTsTest": [
    { "note": "Sistema TS TEST, medico", "user": "MEDICO01", "password": "fake-ts-1", "pincode": "0000" }
  ]
}
```

## Other notes

```bash
echo "not json"
```
