# Ban Appeal Server & Plugin

This repo contains two things, a webserver for ban appeals and a python cog/plugin for [modmail](https://github.com/kyb3r/modmail) which is [here](ban_appeal/ban_appeal.py).

## Setting up

To get started with it, first you need to have an active instance of both [modmail](https://github.com/kyb3r/modmail) and [logviewer](https://github.com/kyb3r/logviewer) otherwise it won't work.

## Docker

To host with docker:

* I'll assume you have docker installed since you're following docker steps.
* Git clone this repo with `git clone https://github.com/DjDeveloperr/ban_appeal_plugin`.
* Go into the directory where you cloned it and open a terminal session inside the `ban_appeal_plugin` directory.
* Then, build the docker image by running this command `docker build . -t appeal-server --build-arg PORT=2012`, replace `PORT=2012` with whatever port you want the application to run on, it can **only** be set during build process.
* Run `cp .env.example .env` if on linux/osx or `copy .env.example .env` for windows and fill the `.env` file with all the correct tokens and IDs .
* After the image has been built, run it in a container with the command `docker run -d -p PORT:PORT --env-file .env --restart unless-stopped appeal-server`, the `PORT` has to be the same port you provided in the previous step while building the image. The command you run looks something like this `docker run -d -p 2012:2012 --env-file .env --restart unless-stopped appeal-server`.

Following the above steps properly will have a fully functioning appeal server running on a docker container.

## Selfhost

To host in your machine:

* Assuming you have deno installed, run `cp .env.example .env` if on linux/osx or `copy .env.example .env` for windows.
* Fill the `.env` file with all the correct tokens and IDs.
* Start the app by running `deno run --no-check --allow-net --allow-read --allow-write --allow-env main.ts`.
  
If you did everything correctly you should see `Listening to ...` in console which means it's running.

## Adding the plugin and instructions to use it

`[p]` is your prefix.
To get started with the plugin:

* First add the plugin to your bot by running `[p]plugins add DjDeveloperr/ban_appeal_plugin/ban_appeal@main`.
* You can configure the ban appeals category where channels will be made for appeals by running `[p]banappeal category category_id`, don't provide `category_id` to see the currently set category.
* You can add a question for appeals by doing `[p]banappeal questions add your question` or you can add in bulk by doing `[p]banappeal questions setlist "question1" "question2"` questions with spaces must be wrapped in quotes `""` like `"this"`.
* To remove a question `[p]banappeal questions remove index-of-the-question`, you can find the list of questions and see their indexes by running `[p]banappeal questions list`
* `[p]accept` to accept an appeal and `[p]deny` to reject it.

## Commands

There's a few commands in the plugin. `[p]` is your prefix.

* [p]accept
* [p]deny
* [p]banappeal

## Environmental Variables

You need to obtain few env variables for this.

* `MONGO` - It's your mongodb URI which you use for your [modmail](https://github.com/kyb3r/modmail) instance and add `/?authMechanism=SCRAM-SHA-1` to it if there's no query parameter already in the URI. It looks something like `mongodb+srv://Username:YourPassword@modmail-kjvn21.mongodb.net/?authMechanism=SCRAM-SHA-1` as I did have a query parameter already, I added `&authMechanism=SCRAM-SHA-1`.
* `PORT` - The port on which the server will run on.
* `GUILD_ID` - The modmail guild ID used in your [modmail](https://github.com/kyb3r/modmail) instance.
* `CLIENT_ID` - The client ID of your modmail bot, it can be obtained [here](https://discord.com/developers/applications) in the `OAuth2` section.
* `CLIENT_SECRET` - The client secret of your modmail bot, it can also be obtained in the `OAuth2` section of your bot in [discord.dev](https://discord.com/developers/applications).
* `TOKEN` - The token of your modmail bot, you can find it in the `Bot` section in [discord.dev](https://discord.com/developers/applications).
* `REDIRECT_URI` - The domain/ip of your server where everyone can access your ban appeals server, if you use a domain you're on your own to setup a reverse proxy like nginx. Your domain/ip should also contain `/discord` with it like: `http://localhost:6969/discord`. Note you also have to add this in the `Redirects` section in the `OAuth2` menu of your bot in [discord.dev](https://discord.com/developers/applications), otherwise it won't work.

## License

Check [here](LICENSE) for more info.
