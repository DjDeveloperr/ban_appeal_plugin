import secrets
from datetime import datetime
from typing import Optional

import discord
from core import checks
from core.models import PermissionLevel, getLogger
from discord.ext import commands, tasks
from discord.ext.commands.bot import Bot

logger = getLogger(__name__)


class BanAppeal(commands.Cog):
    """A Plugin to manage the ban appeals server."""

    def __init__(self, bot: Bot):
        self.bot = bot
        self.ban_appeals = bot.db.ban_appeals
        self.config = bot.db.ban_appeal_config
        self.poll_database.start()

    def cog_unload(self):
        if self.poll_database.is_running:
            self.poll_database.cancel()

    async def get_config(self) -> dict:
        config = await self.config.find_one({}) or {}
        if not config.get("category"):
            config["category"] = None
        if not config.get("questions"):
            config["questions"] = []
        return config

    @tasks.loop(seconds=10)
    async def poll_database(self):
        config = await self.get_config()
        if config.get("category") is None:
            return
        async for appeal in self.ban_appeals.find({}):
            if appeal["status"] == "polling":
                await self.handle_new_appeal(appeal, config)

    async def handle_new_appeal(self, appeal, config):
        await self.ban_appeals.update_one({"_id": appeal["_id"]}, {"$set": {"status": "pending"}})
        user = await self.bot.fetch_user(int(appeal["userID"]))
        logger.info(f"New appeal: from {user} - {user.id}")
        embed = discord.Embed(title="Ban Appeal", color=self.bot.main_color)
        embed.timestamp = datetime.utcfromtimestamp(appeal["createdAt"] / 1000)
        embed.set_author(name=str(user), icon_url=user.avatar_url)
        embed.description = f"User created at: <t:{int(user.created_at.timestamp())}:F>"
        for q in appeal["questions"]:
            embed.add_field(name=q["question"], value=q["answer"], inline=False)
        embed.set_footer(text=f"User ID: {user.id}")
        # not let ourselves handle overwrites tbh cause like... 
        # ummmm dpy automatically creates a channel and 
        # syncs the default permissions from the set category
        # so *lets* not do that
        #         overwrites = {
        #             self.bot.modmail_guild.default_role: discord.PermissionOverwrite(
        #                 read_messages=False, send_messages=False
        #             ),
        #         }
        channel = await self.bot.modmail_guild.create_text_channel(
            name=f"appeal-{user.id}",
            category=discord.Object(int(config["category"])),
        )
        await self.ban_appeals.update_one(
            {"_id": appeal["_id"]}, {"$set": {"channel": str(channel.id)}}
        )
        link = await self.create_log_entry(user, channel, self.bot.modmail_guild.owner)
        embed.url = link
        await channel.send(embed=embed)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        appeal = await self.ban_appeals.find_one({"channel": str(message.channel.id)})
        if appeal is not None:
            if message.embeds and message.embeds[0].title == "Ban Appeal":
                message.content = (
                    f"New ban appeal from {message.embeds[0].author.name} - {appeal['userID']}"
                )
                for q in appeal["questions"]:
                    message.content += f"\n\n**Q:** {q['question']}\n> **A:** {q['answer']}"
            await self.append_log(message)

    @commands.group(name="banappeal")
    @checks.has_permissions(PermissionLevel.OWNER)
    async def config_main(self, ctx: commands.Context):
        """
        Configure the ban appeal plugin.
        """

        if ctx.invoked_subcommand is None:
            await ctx.send_help(ctx.command)

    @config_main.command(name="category")
    async def config_category(self, ctx: commands.Context, category: Optional[str]):
        """
        Get the current ban appeal threads category channel ID or set a new one.
        """

        if category is None:
            config = await self.get_config()
            await ctx.send(f"Current category: {config['category']}")
            return

        await self.config.update_one({}, {"$set": {"category": category}}, upsert=True)
        await ctx.send("Successfully set ban appeal threads category!")

    @config_main.group(name="questions")
    async def config_questions_main(self, ctx: commands.Context):
        """
        Configure the ban appeal questions.
        """

        if ctx.invoked_subcommand is None:
            await ctx.send_help(ctx.command)

    @config_questions_main.command(name="list")
    async def config_questions_list(self, ctx: commands.Context):
        """
        List all the current ban appeal questions.
        """

        config = await self.get_config()
        if len(config["questions"]) == 0:
            await ctx.send("No questions have been set!")
            return
        questions = []
        for index, question in enumerate(config["questions"]):
            questions.append(f"{index + 1}. {question}")
        questions = "\n".join(questions)
        await ctx.send(f"Current questions:\n{questions}")

    @config_questions_main.command(name="setlist")
    async def config_questions_setlist(self, ctx: commands.Context, *questions):
        """
        Set a new list of ban appeal questions. Removes all previous ones.
        """

        questions = list(questions)
        await self.config.update_one({}, {"$set": {"questions": questions}}, upsert=True)
        await ctx.send("Successfully set questions list!")

    @config_questions_main.command(name="add")
    async def config_questions_add(self, ctx: commands.Context, *, question: str):
        """
        Add a new ban appeal question to the existing list.
        """

        config = await self.get_config()
        config["questions"].append(question)
        await self.config.update_one({}, {"$set": {"questions": config["questions"]}}, upsert=True)
        await ctx.send("Successfully added question!")

    @config_questions_main.command(name="remove")
    async def config_questions_remove(self, ctx: commands.Context, question_index: int):
        """
        Remove a ban appeal question (at given index starting from 1) from the existing list.
        """

        config = await self.get_config()
        if question_index < 1 or question_index > len(config["questions"]):
            await ctx.send("Invalid question index!")
            return
        config["questions"].pop(question_index - 1)
        await self.config.update_one({}, {"$set": {"questions": config["questions"]}}, upsert=True)
        await ctx.send("Successfully removed question!")

    @commands.command()
    @checks.has_permissions(PermissionLevel.MODERATOR)
    async def accept(self, ctx: commands.Context):
        """
        Accept the ban appeal.
        """

        appeal = await self.ban_appeals.find_one({"channel": str(ctx.channel.id)})
        if appeal is None:
            await ctx.send("No ban appeal linked to this channel.")
            return
        if appeal["status"] != "pending":
            await ctx.send("This appeal is already handled.")
            return

        await self.ban_appeals.update_one({"_id": appeal["_id"]}, {"$set": {"status": "accepted"}})

        try:
            await ctx.guild.unban(discord.Object(int(appeal["userID"])))
        except discord.NotFound:
            await ctx.send("User is not banned, what the fuck?")
            return
        await self.close(ctx.author, ctx.channel, message="Accepted.")

    @commands.command()
    @checks.has_permissions(PermissionLevel.MODERATOR)
    async def deny(self, ctx: commands.Context):
        """
        Deny the ban appeal.
        """

        appeal = await self.ban_appeals.find_one({"channel": str(ctx.channel.id)})
        if appeal is None:
            await ctx.send("No ban appeal linked to this channel.")
            return
        if appeal["status"] != "pending":
            await ctx.send("This appeal is already handled.")
            return

        await self.ban_appeals.update_one({"_id": appeal["_id"]}, {"$set": {"status": "rejected"}})
        await self.close(ctx.author, ctx.channel, message="Rejected.")

    async def create_log_entry(
        self, user: discord.User, channel: discord.TextChannel, creator: discord.Member
    ) -> str:
        key = secrets.token_hex(6)

        await self.bot.db.logs.insert_one(
            {
                "_id": key,
                "key": key,
                "open": True,
                "created_at": str(datetime.utcnow()),
                "closed_at": None,
                "channel_id": str(channel.id),
                "guild_id": str(self.bot.guild_id),
                "bot_id": str(self.bot.user.id),
                "recipient": {
                    "id": str(user.id),
                    "name": user.name,
                    "discriminator": user.discriminator,
                    "avatar_url": str(user.avatar_url),
                    "mod": False,
                },
                "creator": {
                    "id": str(creator.id),
                    "name": creator.name,
                    "discriminator": creator.discriminator,
                    "avatar_url": str(creator.avatar_url),
                    "mod": isinstance(creator, discord.Member),
                },
                "closer": None,
                "messages": [],
            }
        )
        logger.debug("Created a log entry, key %s.", key)
        prefix = self.bot.config["log_url_prefix"].strip("/")
        if prefix == "NONE":
            prefix = ""
        return f"{self.bot.config['log_url'].strip('/')}{'/' + prefix if prefix else ''}/{key}"

    async def append_log(
        self,
        message: discord.Message,
        *,
        message_id: str = "",
        channel_id: str = "",
        type_: str = "thread_message",
    ) -> dict:
        channel_id = str(channel_id) or str(message.channel.id)
        message_id = str(message_id) or str(message.id)

        data = {
            "timestamp": str(message.created_at),
            "message_id": message_id,
            "author": {
                "id": str(message.author.id),
                "name": message.author.name,
                "discriminator": message.author.discriminator,
                "avatar_url": str(message.author.avatar_url),
                "mod": not isinstance(message.channel, discord.DMChannel),
            },
            "content": message.content,
            "type": type_,
            "attachments": [
                {
                    "id": a.id,
                    "filename": a.filename,
                    "is_image": a.width is not None,
                    "size": a.size,
                    "url": a.url,
                }
                for a in message.attachments
            ],
        }

        return await self.bot.db.logs.find_one_and_update(
            {"channel_id": channel_id},
            {"$push": {"messages": data}},
            return_document=True,
        )

    async def close(
        self,
        closer: discord.Member,
        channel: discord.TextChannel,
        message: str = None,
    ) -> None:
        log_data = await self.bot.api.post_log(
            channel.id,
            {
                "open": False,
                "title": channel.name,
                "closed_at": str(datetime.utcnow()),
                "nsfw": channel.nsfw,
                "close_message": message,
                "closer": {
                    "id": str(closer.id),
                    "name": closer.name,
                    "discriminator": closer.discriminator,
                    "avatar_url": str(closer.avatar_url),
                    "mod": True,
                },
            },
        )

        if isinstance(log_data, dict):
            prefix = self.bot.config["log_url_prefix"].strip("/")
            if prefix == "NONE":
                prefix = ""
            log_url = f"{self.bot.config['log_url'].strip('/')}{'/' + prefix if prefix else ''}/{log_data['key']}"

            desc = f"[`{log_data['key']}`]({log_url}): {message}"
        else:
            desc = "Could not resolve log url."
            log_url = None
        user = await self.bot.fetch_user(int(channel.name.replace("appeal-", "")))

        embed = discord.Embed(description=desc, color=self.bot.error_color)
        embed.title = f"{user} (`{user.id}`) Ban Appeal"
        embed.set_footer(text=f"Handled by {closer} ({closer.id})", icon_url=closer.avatar_url)
        embed.timestamp = datetime.utcnow()

        if self.bot.log_channel is not None:
            await self.bot.log_channel.send(embed=embed)

        await channel.delete()


def setup(bot):
    bot.add_cog(BanAppeal(bot))
