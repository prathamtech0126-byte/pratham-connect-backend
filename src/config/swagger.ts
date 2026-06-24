import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Pratham Connect API",
      version: "1.0.0",
      description: "Internal CRM REST API for Pratham Connect",
    },
    servers: [
      { url: "http://localhost:5000", description: "Development" },
      { url: "https://csm-backend-59rq.onrender.com", description: "Production" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        csrfToken: {
          type: "apiKey",
          in: "header",
          name: "X-CSRF-Token",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [
    "./src/routes/*.ts",
    "./src/Leads/routes/*.ts",
    "./src/Leads/facebookautomation/facebook_routes/*.ts",
    "./src/Leads/leadregistration/routes/*.ts",
    "./src/Leads/frontdesk/routes/*.ts",
    "./src/notification/routes/*.ts",
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
