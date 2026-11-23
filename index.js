import app from "./app.js"

const port = Number(process.env.PORT ?? 5000)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a whole number between 1 and 65535.")
}

const server = app.listen(port, () => {
  console.log(`MentorLagbe API is listening on port ${port}.`)
})

server.on("error", (error) => {
  console.error("Could not start the MentorLagbe API:", error.message)
  process.exitCode = 1
})
