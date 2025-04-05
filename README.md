# Hello World Azure Function

This is a simple Azure Function that returns "Hello World" when triggered via HTTP.

## Local Development

1. Install the dependencies:
   ```bash
   npm install
   ```

2. Run the function locally:
   ```bash
   npm start
   ```

3. Navigate to `http://localhost:7071/api/HelloWorld` in your browser to see the "Hello World" message.

## Deployment

To deploy this function to Azure, you can use the Azure Functions Core Tools:

```bash
func azure functionapp publish <YOUR_FUNCTION_APP_NAME>
```

Make sure you have the Azure CLI installed and you're logged in (`az login`).
