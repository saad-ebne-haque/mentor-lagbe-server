const developmentClientOrigin = "http://localhost:3000";
const productionClientOrigin = "https://mentor-lagbe-one.vercel.app";

export function getClientOrigin(environment = process.env.NODE_ENV) {
  return environment === "production"
    ? productionClientOrigin
    : developmentClientOrigin;
}

export function getAllowedOrigins(environment = process.env.NODE_ENV) {
  if (environment === "production") {
    return [productionClientOrigin];
  }

  return [developmentClientOrigin, "http://127.0.0.1:3000"];
}

export const clientOrigin = getClientOrigin();
