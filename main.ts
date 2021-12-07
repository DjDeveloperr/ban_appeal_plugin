import {
  Application,
  Context,
  MongoClient,
  RESTManager,
  Router,
  TokenType,
  UserPayload,
} from "./deps.ts";

let port = Number(Deno.env.get("PORT") ?? "");
if (isNaN(port)) port = 8080;
const REDIRECT_URI = Deno.env.get("REDIRECT_URI") ??
  `http://localhost:${port}/discord`;
const GUILD_ID = Deno.env.get("GUILD_ID")!;
const CLIENT_ID = Deno.env.get("CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("CLIENT_SECRET")!;
const TOKEN = Deno.env.get("TOKEN");

const app = new Application();
const REST = new RESTManager({
  token: TOKEN,
});

const client = new MongoClient();
let mongoAuthString = Deno.env.get("MONGO")!;
if (mongoAuthString.startsWith('"') && mongoAuthString.endsWith('"')) {
  mongoAuthString = mongoAuthString.slice(1, -1);
}
await client.connect(mongoAuthString);
console.log("Connected to MongoDB!");

const db = client.database("modmail_bot");

export type AppealStatus = "polling" | "pending" | "rejected" | "accepted";

export interface AppealQuestion {
  question: string;
  answer: string;
}

export interface Appeal {
  createdAt: number;
  status: AppealStatus;
  userID: string;
  questions: AppealQuestion[];
}

const config = db.collection<{ questions: string[] }>(
  "ban_appeal_config",
);
const appeals = db.collection<Appeal>("ban_appeals");

const router = new Router();

router.get("/", async (ctx) => {
  ctx.response.body = await Deno.readFile("./client/index.html");
  ctx.response.headers.set("content-type", "text/html");
});

router.get("/login", (ctx) => {
  ctx.response.status = 302;
  ctx.response.headers.set(
    "location",
    `https://discord.com/api/v9/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&scope=identify&redirect_uri=${
      encodeURIComponent(REDIRECT_URI)
    }`,
  );
});

router.get("/discord", async (ctx) => {
  const code = ctx.request.url.searchParams.get("code");
  if (!code) {
    ctx.response.status = 400;
    ctx.response.body = "No code provided";
    return;
  }

  try {
    const data = await fetch("https://discord.com/api/v9/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    }).then((res) => res.json());

    if (!data.access_token) throw new Error("failed");

    ctx.response.status = 200;
    // ctx.cookies.set doesn't work
    ctx.response.headers.set(
      "set-cookie",
      `token=${data.access_token}; expires=${
        new Date(Date.now() + data.expires_in * 1000).toUTCString()
      }`,
    );
    ctx.response.headers.set("content-type", "text/html");
    ctx.response.body = `<script>window.location.href = "/"</script>`;
  } catch (e) {
    ctx.response.status = 400;
    ctx.response.body = "Authorization failed";
  }
});

router.get("/style.css", async (ctx) => {
  ctx.response.body = await Deno.readFile("./client/style.css");
  ctx.response.headers.set("content-type", "text/css");
});

router.get("/script.js", async (ctx) => {
  ctx.response.body = await Deno.readFile("./client/script.js");
  ctx.response.headers.set("content-type", "text/javascript");
});

router.get("/font/:name", async (ctx) => {
  try {
    if (ctx.params.name.includes("..")) throw new Error("Invalid path");
    const file = await Deno.readFile("./client/font/" + ctx.params.name);
    ctx.response.body = file;
  } catch (e) {
    ctx.response.status = 404;
    ctx.response.body = "Not found";
  }
});

async function performChecks(
  ctx: Context,
): Promise<UserPayload | undefined> {
  const token = await ctx.cookies.get("token");

  if (!token) {
    ctx.response.status = 401;
    ctx.response.body = {
      error: { title: "Huh", description: "You're not supposed to be here." },
    };
    return;
  }

  const rest = new RESTManager({
    tokenType: TokenType.Bearer,
    token,
  });

  const user = await rest.endpoints.getCurrentUser().catch(() => undefined);

  if (!user) {
    ctx.response.status = 401;
    ctx.cookies.delete("token");
    ctx.response.body = {
      error: { title: "Error", description: "Not authorized" },
    };
    return;
  }

  const ban = await REST.endpoints.getGuildBan(GUILD_ID, user.id).catch(() =>
    undefined
  );
  if (!ban) {
    ctx.response.body = {
      error: { title: "Nope.", description: "You're not banned." },
      user,
    };
    return;
  }

  const appeal = await appeals.findOne({ userID: user.id }, {
    noCursorTimeout: false,
  });

  if (appeal) {
    if (appeal.status === "accepted" || appeal.status === "rejected") {
      ctx.response.body = {
        error: {
          title: "Cannot re-appeal.",
          description: `Your last appeal was ${appeal.status}.${
            appeal.status === "accepted" 
              ? "\nYou have since been banned again, and are ineligible to re-appeal." 
              : ""
          }`,
        },
        user,
      };
      return;
    } else {
      ctx.response.body = {
        error: {
          title: "Wait.",
          description: `Your appeal is currently being processed.`,
        },
        user,
      };
      return;
    }
  }

  return user;
}

router.get("/api/status", async (ctx) => {
  const user = await performChecks(ctx);
  if (!user) return;

  const questions =
    (await config.findOne(undefined, { noCursorTimeout: false }) ??
      { questions: [] }).questions;
  if (questions.length === 0) {
    questions.push(
      "Who banned you?",
      "Why do you think you were banned?",
      "Are you sorry?",
    );
  }
  ctx.response.body = {
    user,
    questions,
  };
});

router.post("/api/appeal", async (ctx) => {
  try {
    const user = await performChecks(ctx);
    if (!user) return;

    const body = await ctx.request.body({ type: "json" }).value;
    if (typeof body.questions !== "object" || !Array.isArray(body.questions)) {
      throw new Error("questions not provided");
    }

    if (
      body.questions.some((q: AppealQuestion) =>
        typeof q !== "object" || typeof q.question !== "string" ||
        typeof q.answer !== "string" ||
        q.answer.length < 10 ||
        q.answer.length > 500
      )
    ) {
      throw new Error("invalid question/answer");
    }

    await appeals.insertOne({
      status: "polling",
      userID: user.id,
      questions: body.questions,
      createdAt: Date.now(),
    });

    ctx.response.body = {
      error: {
        title: "Success.",
        description: "Your appeal has been submitted.",
      },
    };
  } catch (e) {
    ctx.response.status = 400;
    ctx.response.body = {
      error: { title: "Error", description: (e as Error).message },
    };
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

app.addEventListener(
  "listen",
  ({ port }) => console.log(`Listening on port: ${port}`),
);

await app.listen({ port });
