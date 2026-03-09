import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { SITE } from "../consts";

export async function GET(context: { site: URL }) {
  const posts = await getCollection("posts");

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site,
    items: posts
      .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
      .map((post) => ({
        title: post.data.title,
        pubDate: post.data.date,
        description: post.data.description,
        link: `/posts/${post.id}/`,
      })),
  });
}
