/// <reference lib="dom" />

const token = Cookies.get("token");
let user;

const MIN_CHARS = 10;
const MAX_CHARS = 500;

const scenes = {
  connecting: document.getElementById("connecting"),
  error: document.getElementById("error"),
  appeal: document.getElementById("appeal"),
};

let currentScene = scenes.connecting;

function setScene(scene) {
  currentScene.classList.add("hidden");
  currentScene = scenes[scene];
  currentScene.classList.remove("hidden");
}

function updateUser(profile) {
  if (!user) return;
  profile.innerHTML = "";

  const img = document.createElement("img");
  img.id = "avatar";
  img.alt = "Avatar";
  if (user.avatar) {
    img.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  } else {
    img.src = `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator) % 5}.png`;
  }
  profile.appendChild(img);

  const username = document.createElement("span");
  username.id = "username";
  username.innerText = `${user.username}#${user.discriminator}`;
  profile.appendChild(username);

  const sideNote = document.createElement("span");
  sideNote.classList.add("side-note");
  sideNote.classList.add("logout");
  sideNote.innerHTML = `Not you? <a onclick="logout()" href="#">Logout</a>`;
  profile.appendChild(sideNote);
}

function setError(error) {
  if (typeof error === "string") {
    error = {
      type: "Error",
      description: error,
    };
  }

  const elem = document.getElementById("error");
  elem.innerHTML = "";

  const h2 = document.createElement("h2");
  h2.innerText = error.title;
  elem.appendChild(h2);
  
  const span = document.createElement("span");
  span.id = "error-message";
  span.innerText = error.description;
  elem.appendChild(span);
  
  if (user) {
    const profile = document.createElement("div");
    profile.id = "profile";
    profile.style.paddingTop = "16px";
    updateUser(profile);
    elem.appendChild(profile);
  }

  setScene("error");
}

async function setForm(list) {
  if (!user) return;

  const elem = document.getElementById("appeal");
  elem.innerHTML = "";

  const form = document.createElement("form");
  form.id = "appeal-form";
  form.onsubmit = submitAppeal;

  const profile = document.createElement("div");
  profile.id = "profile";
  updateUser(profile);
  form.appendChild(profile);

  const h2 = document.createElement("h2");
  h2.innerText = "Ban appeal";
  form.appendChild(h2);

  const questions = document.createElement("div");
  questions.id = "questions";

  for (const qi in list) {
    const q = list[qi];
    const p = document.createElement("p");
    p.classList.add("question");
    
    const h4 = document.createElement("h4");
    h4.innerText = q;

    const error = document.createElement("span");
    error.id = `error-${qi}`;
    error.style.display = "block";
    error.classList.add("question-error");

    const textarea = document.createElement("textarea");
    textarea.id = `answer-${qi}`;
    textarea.classList.add("input");
    textarea.classList.add("answer");
    textarea.setAttribute("minlength", String(MIN_CHARS));
    textarea.setAttribute("maxlength", String(MAX_CHARS));
    textarea.setAttribute("placeholder", `Enter your answer here. Min ${MIN_CHARS} characters, ${MAX_CHARS} max.`);
    textarea.oninput = () => validateForm(textarea, error);
    
    p.appendChild(h4);
    p.appendChild(error);
    p.appendChild(textarea);
    
    questions.appendChild(p);
  }

  form.appendChild(questions);

  const submit = document.createElement("div");
  submit.id = "submit";
  submit.classList.add("btn");
  submit.classList.add("btn-disabled");
  submit.onclick = submitAppeal;
  submit.innerText = "Submit";
  form.appendChild(submit);

  elem.appendChild(form);

  setScene("appeal");
}

function validateAnswer(textarea, error) {
  if (textarea.value.length < MIN_CHARS) {
    error.innerText = `Must be at least ${MIN_CHARS} characters.`;
    return false;
  }
  else if (textarea.value.length > MAX_CHARS) {
    error.innerText = `Must be at most ${MAX_CHARS} characters.`;
    return false;
  }
  else {
    error.innerText = "";
    return true;
  }
}

function validateForm(textarea, error) {
  const answers = document.getElementsByClassName("answer");
  let valid = true;
  for (const answer of answers) {
    if (!validateAnswer(answer, answer.id === textarea.id ? error : {})) {
      valid = false;
    }
  }
  const submit = document.getElementById("submit");
  if (valid) {
    submit.classList.remove("btn-disabled");
  } else {
    submit.classList.add("btn-disabled");
  }
}

let questions = [];

if (!token) {
  window.location.href = "/login";
} else {
  fetch("/api/status").then(e => e.json()).then(e => {
    if (e.user) {
      user = e.user;
    }

    if (e.error) {
      setError(e.error);
    } else {
      questions = e.questions;
      setForm(e.questions);
    }
  });
}

function submitAppeal() {
  if (document.getElementById("submit").classList.contains("btn-disabled")) {
    return;
  }

  fetch("/api/appeal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      questions: questions.map((q, i) => ({ question: q, answer: document.getElementById(`answer-${i}`).value })),
    }),
  }).then(e => e.json()).then(e => {
    if (e.error) {
      setError(e.error);
    } else {
      console.log(e);
    }
  });
}

function logout() {
  Cookies.remove("token");
  window.location.href = "/";
}
