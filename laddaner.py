import yt_dlp

def progress_hook(d):
    if d['status'] == 'downloading':
        print(f"\r{d['_percent_str']} of {d['_total_bytes_str']} at {d['_speed_str']} ETA {d['_eta_str']}", end='')
    elif d['status'] == 'finished':
        print('\nDownload complete, merging streams...')

ydl_opts = {
    'format': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
    'merge_output_format': 'mp4',
    'progress_hooks': [progress_hook],
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    ydl.download(['https://www.youtube.com/watch?v=GGuLAZG-ll0&ab_channel=BrysonDeChambeau'])
