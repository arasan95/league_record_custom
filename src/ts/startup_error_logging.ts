window.addEventListener("error", (event) => {
    const details = event.error && event.error.stack ? event.error.stack : event.message;
    console.error(`[startup-error-stack] ${details}`);
});

window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const details = reason && reason.stack ? reason.stack : String(reason);
    console.error(`[startup-rejection-stack] ${details}`);
});
