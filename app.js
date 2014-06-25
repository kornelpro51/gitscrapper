var fs = require('fs');
var request = require('request');
var cheerio = require('cheerio');
var redis = require('redis'),
    client = redis.createClient();


var csvStream = csv.createWriteStream({headers: true});
client.on('error', function (err) {
    console.log('Error ' + err);
});
var wrapString = function (str) {
	if (typeof str == 'undefined') {
		return "";
	}
	if (str.indexOf && (str.indexOf(',') !== -1 || str.indexOf('"') !== -1)) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

var findFollowers = function (furl, deep) {
	console.log(furl);
	request(furl, function(error, response, html){
		var $ = cheerio.load(html);
		$('.follow-list-name').each(function(idx, elem){
			var follower = $(this).find('a').attr('href');
			//findUserInfo(follower, deep);
			client.get(follower, function(err, reply) {
				console.log(furl, reply);
				if (reply == null) {
					client.set(follower, 'visited');
					findUserInfo(follower, deep);
				}
			});
        });
        if ($('.pagination').length > 0 ) {
        	var nextPage = $('.pagination').children().eq(1).attr('href');
        	if (nextPage != null) {
				findFollowers(nextPage);
        	}
        }
	});
}
function outputToFile(info) {
	log.write(wrapString(info.fullname) + "," + wrapString(info.username) 
		+ "," + wrapString(info.email) + "," + wrapString(info.location) + '\n');
}
var findUserInfo = function (path, deep) {
	var url = 'https://github.com' + path;
	var followerUrl = 'https://github.com' + path + '/followers';
	var apiUrl = 'https://api.github.com/users' + path + '/events/public';
	request(url, function(error, response, html){
		if(!error){
			var $ = cheerio.load(html);
			var info = { fullname : '', username : '', email : '', location: ''};
			info.fullname = $('.vcard-fullname').text();
			info.username = $('.vcard-username').text();
			if ($('.js-obfuscate-email').length > 0) {
				info.email = decodeURIComponent($('.js-obfuscate-email').data('email'));
			}
			info.location = $('li[itemprop="homeLocation"]').text();
			if ( info.email === '') {
				request({
				    url: apiUrl,
				    headers: {
				        'User-Agent': 'request'
				    }
				}, function(error, response, html){
					var start_idx = html.indexOf('"email":');
					var end_idx = -1;
					if (start_idx >= 0 ) {
						end_idx = html.indexOf('"', start_idx+10);
					}
					if (start_idx > 0 && end_idx > 0) {
						info.email = html.substring(start_idx+10, end_idx);
					}
					//console.log(" - github api - ", html, start_idx, end_idx);

					//console.log(info);
					outputToFile(info);
				});
			} else {
				//console.log(info);
				outputToFile(info);
			}
			
			//findFollowers(followerUrl, deep + 1);
			if (deep < 2) {
				findFollowers(followerUrl, deep + 1);
			}
		}
	//  if ( deep == 0 ) {
	//		log.end()	
	//	}
	})
}
var log = fs.createWriteStream('log.txt', {'flags': 'w'});
var myArgs = process.argv.slice(2);
//findUserInfo('/kevinsawicki', 0);
for (var i = myArgs.length - 1; i >= 0; i--) {
	findUserInfo('/' + myArgs[i], 0);
};
/*
app.get('/scrape', function(req, res){
	var log = fs.createWriteStream('log.txt', {'flags': 'a'});
	findUserInfo('/kevinsawicki', 0)
	res.send('Check your console!');
})

app.listen('8081')
console.log('Magic happens on port 8081');
exports = module.exports = app;*/