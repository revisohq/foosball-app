const mongodb = require('mongodb')
const express = require('express')
const bodyParser = require('body-parser')
const ajv = require('ajv')()
const elo = require('./elo')

const app = express()
app.use(bodyParser.json())

const mongoUrl = process.env.MONGOLAB_URI || 'mongodb://localhost:27017/foosball-rankings'
const connectDb = mongodb.MongoClient.connect(mongoUrl)

app.get('/', (req, res) => {
	connectDb
		.then(db => db.collection('players'))
		.then(players => players.find().sort({elo: -1}).toArray())
		.then(playerList => res.json(playerList.map(player => ({name: player.name, elo: player.elo}))))
		.catch(err => res.status(500).send(err))
})

app.get('/players/:playername', (req, res) => {
	connectDb
		.then(db => db.collection('players'))
		.then(players => players.findOne({name: req.params.playername}))
		.then(player => res.json(player))
		.catch(err => res.status(500).send(err))
})

app.post('/players', (req, res) => {
	
	const valid = ajv.validate({
		type: 'object',
		required: ['name'],
		properties: {
			name: { type: 'string' },
		},
	}, req.body);

	if (!valid) {
		return res.status(400).send(ajv.errors)
	}

	connectDb
		.then(db => db.collection('players'))
		.then(players => {
			players.findOne({name: req.body.name})
				.then(player => {
					if (player) {
						return res.status(400).send('player already exists')
					}

					return players.insertOne({
							name: req.body.name,
							elo: 1000,
						})
						.then(player => {
							return res.send('player created')
						})
				})
		})
		.catch(err => res.status(500).send(err))
})

app.post('/game', (req, res) => {
	const valid = ajv.validate({
		type: 'object',
		required: ['winner', 'loser'],
		properties: {
			winner: { type: 'string' },
			loser: { type: 'string' },
		},
	}, req.body);

	if (!valid) {
		return res.status(400).send(ajv.errors)
	}

	connectDb
		.then(db => db.collection('players'))
		.then(col => {
			return col.find({ name: { $in: [req.body.winner, req.body.loser] }}).toArray()
				.then(players => {
					const winner = players.find(player => player.name === req.body.winner)
					if (!winner) {
						return res.status(400).send('winner not found')
					}

					const loser = players.find(player => player.name === req.body.loser)
					if (!loser) {
						return res.status(400).send('loser not found')
					}

					const delta = elo(winner.elo, loser.elo)
					const date = Date()

					return Promise.all([
							col.update({ _id: mongodb.ObjectID(winner._id) }, {
								$inc: { elo: delta, wins: 1 }, 
								$push: { history: { time: date, elo: winner.elo + delta, result: 'win'}},
							}),
							col.update({ _id: mongodb.ObjectID(loser._id) }, {
								$inc: { elo: -delta, loses: 1 },
								$push: { history: { time: date, elo: loser.elo - delta, result: 'loss' }},
							}),
						])
						.then(() => res.send('match resolved'))
				})
		})
		.catch(err => res.status(500).send(err.stack))
})

const port = process.env.PORT || 3000
app.listen(port, () => {
	console.log('Listening on', port)
})