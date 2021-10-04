//? Initialization
const fs = require('fs')
const Gamedig = require('gamedig')

const { Client, Intents } = require('discord.js')
var selectedIntents = []
for (intent in Intents.FLAGS) { selectedIntents.push(Intents.FLAGS[intent]) }
const client = new Client({ intents: selectedIntents })

var Config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
var ServerData = {}

client.login(Config.discord.token)


//? Structure Prep
if (!fs.existsSync('./players')) fs.mkdirSync('./players')


//? Scan Server
async function PlayerScan() {
    Config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
    await query()

    Team1 = []
    Team2 = []

    var ScannedPlayers = await Rcon(['ListPlayers'])
    ScannedPlayers = ScannedPlayers.toString().split('\n')
    ScannedPlayers.shift()

    await ScannedPlayers.forEach(async(player) => {
        try {
            if (player === '----- Recently Disconnected Players [Max of 15] -----' || player.includes('Since Disconnect')) return
            var PlayerData = {
                steamID: player.split(' | SteamID: ')[1].split(' | Name: ')[0],
                name: player.split(' | Name: ')[1].split(' | Team ID: ')[0],
                kills: 0,
                deaths: 0,
                shotBy: [],
            }
            var NewPlayer = await GetPlayer(PlayerData.name)
            if (!NewPlayer) UpdatePlayer(PlayerData), NewPlayer = PlayerData

            NewPlayer['team'] = player.split(`${PlayerData.name} | Team ID: `)[1].split(' | ')[0]
            NewPlayer['ratio'] = NewPlayer.kills / NewPlayer.deaths || 0
            if (NewPlayer.ratio === Infinity) NewPlayer.ratio = NewPlayer.kills
            NewPlayer.ratio = Math.round(NewPlayer.ratio * 100) / 100

            if (NewPlayer.team === '1') Team1.push(NewPlayer)
            if (NewPlayer.team === '2') Team2.push(NewPlayer)
        } catch (err) {}
    })

    await Team1.sort((a, b) => (a.ratio < b.ratio) ? 1 : ((b.ratio < a.ratio) ? -1 : 0))
    await Team2.sort((a, b) => (a.ratio < b.ratio) ? 1 : ((b.ratio < a.ratio) ? -1 : 0))

    var Team1Str = '>>> '
    var Team2Str = '>>> '
    for (var player of Team1) {
        Team1Str += `${player.name}: \`${player.ratio}\`\r`
    }
    for (var player of Team2) {
        Team2Str += `${player.name}: \`${player.ratio}\`\r`
    }

    embed = {
        title: `${ServerData.name}`,
        color: Config.discord.color,
        description: `${ServerData.players.length} / ${ServerData.maxplayers} Players`,
        fields: [
            { name: `Team 1 - ${Team1.length} Players`, value: Team1Str, inline: true },
            { name: "\u200B", value: "\u200B", inline: true },
            { name: `Team 2 - ${Team2.length} Players`, value: Team2Str, inline: true }
        ],
        thumbnail: {
            url: Config.discord.thumbnail
        },
        timestamp: new Date()
    }

    var guild = await client.guilds.fetch(Config.discord.guild)
    var channel = await guild.channels.fetch(Config.discord.channel)
    if (Config.discord.message) var message = await channel.messages.fetch(Config.discord.message)
    else channel.send({ embeds: [embed] }).then(msg => {
        Config.discord.message = msg.id
        fs.writeFileSync('./config.json', JSON.stringify(Config, null, '\t'))
    })
    message.edit({ embeds: [embed] })

}
setInterval(PlayerScan, 10000), PlayerScan()

var currentLog
var previousLog
fs.watchFile(Config.log, async(event, filename) => {
    if (!filename) return
    currentLog = fs.readFileSync(Config.log).toString()
    if (!previousLog) return previousLog = currentLog
    await Events(currentLog.replace(previousLog, ''))
    previousLog = currentLog
})

async function Events(log) {
    for (line of log.split('\n')) {
        try {
            if (line.includes('LogSquad: Player:') && line.includes('ActualDamage=')) {
                var victim = await GetPlayer(line.split('LogSquad: Player:')[1].split(' ActualDamage=')[0])
                var attacker = await GetPlayer(line.split(' from ')[1].split(' caused by ')[0])
                if (victim.shotBy.length > 2) victim.shotBy.shift()
                if (!victim.shotBy.includes(attacker.name) && victim.name !== attacker.name) victim.shotBy.push(attacker.name)
                await UpdatePlayer(victim)
            }

            if (line.includes('::Wound():')) {
                var victim = await GetPlayer(line.split('::Wound(): Player:')[1].split(' KillingDamage=')[0])
                victim.shotBy.forEach(async attacker => {
                    attacker = await GetPlayer(attacker)
                    attacker.kills += 0.5
                    await UpdatePlayer(attacker)
                })
                console.log(`${victim.name} was wounded by ${victim.shotBy.join(' & ')}`);
            }

            if (line.includes('::Die():')) {
                var victim = await GetPlayer(line.split('::Die(): Player:')[1].split(' KillingDamage=')[0])
                victim.shotBy.forEach(async attacker => {
                    attacker = await GetPlayer(attacker)
                    attacker.kills += 0.5
                    await UpdatePlayer(attacker)
                })
                victim.deaths++;
                console.log(`${victim.name} was killed by ${victim.shotBy.join(' & ')}`)
                victim.shotBy = []
                await UpdatePlayer(victim)
            }

            if (line.includes('LogSquad: StartNewGame')) {
                console.log('New Game Detected, Wiping PlayerDB...')
                fs.readdirSync('./players').forEach(file => {
                    fs.unlinkSync(`./players/${file}`)
                })
            }
        } catch (err) { console.log(err) }
    }
}






//!
//! Functions
//!

//? Update Player Data
function UpdatePlayer(data) {
    if (!data) return
    try {
        if (data.name.includes('|')) data.name = data.name.replace('|', '-')
        fs.writeFileSync(`./players/${data.name}.json`, JSON.stringify(data, null, '\t'))
    } catch (err) { return }
}

//? Get Player Data
function GetPlayer(name) {
    try {
        if (name.includes('|')) name = name.replace('|', '-')
        if (fs.existsSync(`./players/${name}.json`)) {
            var data = JSON.parse(fs.readFileSync(`./players/${name}.json`, 'utf8'))
            if (data.name.includes('|')) data.name = data.name.replace('|', '-')
            return data
        } else return false
    } catch (err) { return false }
}

//? Query
function query() {
    return Gamedig.query({
        type: 'squad',
        host: Config.host,
        port: Config.port
    }).then(body => ServerData = body).catch(() => null)
}

//? Rcon
async function Rcon(commands) {
    try {
        var { Rcon } = require("rcon-client")
        const rcon = await Rcon.connect({
            host: Config.host,
            port: Config.rcon.port,
            password: Config.rcon.password
        })

        var response = []
        for (command of commands) {
            response.push(await rcon.send(command))
        }

        rcon.on('error', (err) => console.log(err))
        rcon.end()

        return response
    } catch (e) {
        console.log(e)
    }
}