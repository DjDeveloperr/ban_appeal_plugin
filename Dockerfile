FROM denoland/deno:1.16.3

ARG PORT

EXPOSE ${port}

WORKDIR /app

USER deno

# Cache the dependencies
COPY deps.ts .
RUN deno cache deps.ts

# These steps will be re-run upon each file change in your working directory:
ADD . .
# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD ["run", "--no-check", "--allow-net", "--allow-env", "--allow-read", "main.ts"]