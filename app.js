var fs = require('fs');
var request = require('request');
var cheerio = require('cheerio');
var redis = require('redis'),
    redisClient     = redis.createClient();

var sys = require('sys')
var exec = require('child_process').exec;
var child;
var isWritten;
var rewriteBuffer = [];
var mongoose = require('mongoose');

var Schema = mongoose.Schema
  , ObjectId = Schema.ObjectId;

var MemberSchema = new Schema({
    email         : {type: String, unique: true}
  , fullname      : String
  , nickname      : String
  , location      : String
});

mongoose.connect('mongodb://localhost/gitmembers');

// Error handler
mongoose.connection.on('error', function (err) {
	console.log(err)
})

// Reconnect when closed
mongoose.connection.on('disconnected', function () {
	connect()
})

var Member = mongoose.model('Member', MemberSchema);

var wrapString = function (str) {
	if (typeof str == 'undefined') {
		return "";
	}
	if (str.indexOf && (str.indexOf(',') !== -1 || str.indexOf('"') !== -1)) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function outputToFile(info) {
	
	//console.log(" - user  ", JSON.stringify(info));
	/*
	isWritten = log.write(wrapString(info.fullname) + "," + wrapString(info.username) 
		+ "," + wrapString(info.email) + "," + wrapString(info.location) + '\n');
	if (!isWritten) {
		rewriteBuffer.push(info);
	}
	*/
	if (!info.email || info.email === "") {
		return;		
	}
	Member.find({email: info.email}, function(err, m) {
		if (m.length > 0) {
			if (!info.location && info.location != "") {
				m[0].location = info.location;
			}
			if (!info.nickname && info.nickname != "") {
				m[0].nickname = info.nickname;
			}
			m[0].save();
		} else {
			var member = new Member(info);
			member.save();
		}
	});
}

var findFollowers = function (furl, deep) {
	request(furl, function(error, response, html){
		if(!error) {
			var $ = cheerio.load(html);
			$('.follow-list-name').each(function(idx, elem){
				var follower = $(this).find('a').attr('href');
				redisClient.get(follower, function(err, reply) {
					if (reply == null) {
						findUserInfo(follower, deep);
					} else {
						//console.log(" *** redis dup *** ", follower, reply);
					}
				});
	        });
	        if ($('.pagination').length > 0 ) {
	        	var nextPage = $('.pagination').children().eq(1).attr('href');
	        	if (nextPage != null) {
					findFollowers(nextPage);
	        	}
	        }
		}
	});
}

var findUserInfo = function (path, deep) {
	redisClient.set(path, 'visited');

	var url = 'https://github.com' + path;
	var followerUrl = 'https://github.com' + path + '/followers';
	var apiUrl = 'https://api.github.com/users' + path + '/events/public';

	// fetch profile page
	request(url, function(error, response, html){
		if(!error){
			var $ = cheerio.load(html);
			var info = { fullname : '', nickname : '', email : '', location: ''};
			info.fullname = $('.vcard-fullname').text();
			info.nickname = $('.vcard-username').text();
			if ($('.js-obfuscate-email').length > 0) {
				info.email = decodeURIComponent($('.js-obfuscate-email').data('email'));
			}
			info.location = $('li[itemprop="homeLocation"]').text();
			if (info.email != '') {
				outputToFile(info);
				info.stored = true;
			} else {
				info.stored = false;
			}

			// fetch git api 
			request({
			    url: apiUrl,
			    headers: {
			        'User-Agent': 'request'
			    }
			}, function(error, response, html){
				if (!error && html.indexOf && html.substring) {
					var userEvents = JSON.parse(html);
					var i = 0;
					/*
					response json format

					[
					  .....
					  ,
					  {
					    "id": "2155439650",
					    "type": "PushEvent",
					    "actor": {
					    	...
					    },
					    "payload": {
					      ....
					      ,
					      "commits": [
					        {
					          "sha": "75405cf73d501726f5a9aacf88045b9c53c3da54",
					          "author": {
					          	"email" : " ********** ",
					          	"name"  : " ********** ",
					          }
					        }
					      ]
					    }, ...
					  }, ....
					]
					*/
					for(var idx in userEvents) {
						if (userEvents[idx].payload && userEvents[idx].payload.commits && userEvents[idx].payload.commits.length > 0) {
							for (i = 0; i < userEvents[idx].payload.commits; i++) {
								if (userEvents[idx].payload.commits[i].author) {
									// if commite was done by info.user
									if (info.fullname == userEvents[idx].payload.commits[i].name ) {
										if (info.stored == false) {
											info.email = userEvents[idx].payload.commits[i].email;
											info.stored = true;
											outputToFile(info);
										}
									} else {
										outputToFile({
											fullname: userEvents[idx].payload.commits[i].name,
											email: userEvents[idx].payload.commits[i].email
										});
									}
								}
							}
						}
					}
				}
			});
			
			findFollowers(followerUrl, deep + 1);
			/*if (deep < 0) {
				findFollowers(followerUrl, deep + 1);
			}*/
		}
	})
}
var log = fs.createWriteStream('log.csv', {'flags': 'w'});

log.on('drain',function(){
	while (rewriteBuffer.length > 0 ){
		outputToFile(rewriteBuffer.shift()); //<-- the place to test
	}
});

// write csv headers
// outputToFile({ fullname : 'fullname', nickname : 'username', email : 'email', location: 'location'});

var myArgs = process.argv.slice(2);
var counter = 0;
//findUserInfo('/kevinsawicki', 0);
child = exec("redis-cli FLUSHALL", function (error, stdout, stderr) {
	console.log("redis-cli FLUSHALL");
	console.log(stdout);
	if (myArgs[0] == '-d') {
		for (var i = 0; i < myArgs.length; i++) {
			findUserInfo('/' + myArgs[i], 0);
		};
		var timer = setInterval(function() {
			counter++;
			Member.count({}, function(err, count) {
				if (err) {
					console.log( ' ** error on getting scrapped user count ** ' )
				} else {
					console.log(' scrapped user count : ', count ,'   total time: ', counter*10 ,'(s)   avg: ', count * 360 / counter ,' / hr');
				}
			});
		}, 10000);
	} else {
		for (var i = 0; i < myArgs.length; i++) {
			findUserInfo('/' + myArgs[i], 0);
		};
	}
});